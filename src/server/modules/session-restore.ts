import PQueue from 'p-queue'
import { omit } from 'es-toolkit'
import {
  isProjectedRestoredWorkspaceRepo,
  type ProjectedRestoredWorkspaceRepoRuntime,
  type RepoRuntimeProjection,
  type RestoredWorkspaceRepoRuntime,
  type WorkspaceRestoreResult,
  type WorkspaceRuntimeRestoreSnapshot,
  type ServerWorkspaceState,
} from '#/shared/api-types.ts'
import {
  workspaceSessionEntryId,
  sameWorkspaceSessionEntry,
  type RemoteWorkspaceSessionEntry,
  type RemoteRepoTarget,
  type WorkspaceSessionEntry,
} from '#/shared/remote-repo.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import { readRepoProjection } from '#/server/modules/repo-read-paths.ts'
import {
  acquireRepoRuntimeLease,
  isCurrentRepoRuntimeMembership,
  releaseRepoRuntimeMembershipLease,
  runSerializedInitialWorkspaceProbe,
  workspaceProbeStateForRuntime,
  type RepoRuntimeMembershipLeaseEntry,
} from '#/server/modules/repo-runtimes.ts'
import { probeWorkspace } from '#/server/modules/workspace-probe.ts'
import type { WorkspaceProbeState, WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'
import { parseWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { runRemoteLifecycleWrite } from '#/server/modules/remote-lifecycle-write-paths.ts'
import { compareAndReplaceServerWorkspaceRepos, getServerWorkspaceState } from '#/server/modules/settings-source.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import { abortableWorkspaceRestore, workspaceRepoDisplayName } from '#/server/modules/workspace-restore-utils.ts'
import { projectWorkspacePaneTabsWithMembershipGuard } from '#/server/modules/workspace-pane-tabs-restore.ts'
import type { WorkspaceCapabilityTransitionHost } from '#/server/workspace-capability-transition-host.ts'
import { workspaceGitCleanupRequired } from '#/server/modules/workspace-capability-transition.ts'

export interface RestoreServerWorkspaceInput {
  userId: string
  clientId: string
  // The repo the user is currently viewing. Only this repo gets the full
  // projection read + pane-tab restore at cold start. Other repos are
  // validated/canonicalized, then returned as stub leases and restored lazily
  // when the user navigates to them.
  activeRepoRoot?: string | null
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost
  signal?: AbortSignal
}

type OpenWorkspaceRepoResult = { kind: 'opened'; opened: OpenedWorkspaceRepo } | { kind: 'invalid' }
type OpenedWorkspaceRepo = RestoredWorkspaceRepoRuntime & {
  lease: RepoRuntimeMembershipLeaseEntry
}
type OpenedProjectedWorkspaceRepo = ProjectedRestoredWorkspaceRepoRuntime & {
  lease: RepoRuntimeMembershipLeaseEntry
}

const MAX_WORKSPACE_MEMBERSHIP_CONFLICT_RETRIES = 3
const restoreQueues = new Map<string, PQueue>()

export async function restoreServerWorkspace(input: RestoreServerWorkspaceInput): Promise<WorkspaceRestoreResult> {
  input.signal?.throwIfAborted()
  const key = restoreQueueKey(input.userId, input.clientId)
  const queue = restoreQueueFor(key)
  try {
    return await queue.add(async () => {
      input.signal?.throwIfAborted()
      let workspace = await getServerWorkspaceState()
      const restoreInput = {
        ...input,
        activeRepoRoot: input.activeRepoRoot ?? workspace.openWorkspaceEntries[0]?.id ?? null,
      }
      const openedByRoot = new Map<string, OpenedWorkspaceRepo>()
      let repaired = false
      let committed = false
      try {
        for (let conflicts = 0; ; conflicts += 1) {
          const outcome = await restoreServerWorkspaceSnapshot(restoreInput, workspace, openedByRoot)
          if (outcome.kind === 'restored') {
            committed = true
            return {
              ...outcome.value,
              status: repaired || outcome.value.status === 'repaired' ? 'repaired' : 'restored',
            }
          }
          repaired ||= outcome.repaired
          if (conflicts >= MAX_WORKSPACE_MEMBERSHIP_CONFLICT_RETRIES) {
            throw new Error('workspace membership restore was superseded too many times')
          }
          workspace = outcome.latestWorkspace
        }
      } finally {
        if (!committed) releaseOpenedRepoRuntimes(input, openedByRoot.values())
      }
    })
  } finally {
    void queue.onIdle().then(() => {
      if (restoreQueues.get(key) === queue && queue.size === 0 && queue.pending === 0) restoreQueues.delete(key)
    })
  }
}

function restoreQueueKey(userId: string, clientId: string): string {
  return `${userId}\0${clientId}`
}

function restoreQueueFor(key: string): PQueue {
  let queue = restoreQueues.get(key)
  if (!queue) {
    queue = new PQueue({ concurrency: 1 })
    restoreQueues.set(key, queue)
  }
  return queue
}

type RestoreServerWorkspaceSnapshotOutcome =
  | { kind: 'restored'; value: WorkspaceRestoreResult }
  | { kind: 'membership-conflict'; latestWorkspace: ServerWorkspaceState; repaired: boolean }

async function restoreServerWorkspaceSnapshot(
  input: RestoreServerWorkspaceInput,
  source: ServerWorkspaceState,
  openedByRoot: Map<string, OpenedWorkspaceRepo>,
): Promise<RestoreServerWorkspaceSnapshotOutcome> {
  input.signal?.throwIfAborted()
  let repoRestoreFailed = false
  const activeRepoRoot = input.activeRepoRoot ?? null
  reconcileOpenedRepoMemberships(input, source.openWorkspaceEntries, openedByRoot)
  for (const entry of source.openWorkspaceEntries) {
    if (openedByRoot.has(workspaceSessionEntryId(entry))) continue
    const result = await openWorkspaceRepo(input, entry, {
      active: workspaceSessionEntryId(entry) === activeRepoRoot,
    })
    if (result.kind === 'invalid') {
      repoRestoreFailed = true
      continue
    }
    openedByRoot.set(result.opened.repoRoot, result.opened)
  }

  input.signal?.throwIfAborted()
  const opened = source.openWorkspaceEntries.flatMap((entry) => {
    const repo = openedByRoot.get(workspaceSessionEntryId(entry))
    return repo ? [repo] : []
  })
  const membership = await compareAndReplaceServerWorkspaceRepos(
    source.openWorkspaceEntries,
    opened.map((repo) => repo.entry),
  )
  if (!membership.matched) {
    return { kind: 'membership-conflict', latestWorkspace: membership.latestWorkspace, repaired: false }
  }

  // Only the active repo's tabs are validated and restored at startup.
  // Non-active repos carry `projection: null` and are restored lazily.
  const openedForLayoutRestore = opened.filter(
    (repo) => isOpenedProjectedRepo(repo) || readableWorkspace(repo.workspaceProbe),
  )
  const expectedMembership = membership.workspace.openWorkspaceEntries
  const projectedTabs = await projectWorkspacePaneTabsWithMembershipGuard({
    restoreInput: input,
    repos: openedForLayoutRestore,
    confirmMembership: async () => await compareAndReplaceServerWorkspaceRepos(expectedMembership, expectedMembership),
    membershipPolicy: 'confirm-after-restore',
  })
  if (!projectedTabs.matched) {
    return {
      kind: 'membership-conflict',
      latestWorkspace: projectedTabs.latestWorkspace,
      repaired: repoRestoreFailed,
    }
  }
  return {
    kind: 'restored',
    value: {
      status: repoRestoreFailed || projectedTabs.repaired ? 'repaired' : 'restored',
      openWorkspaceEntries: opened.map((repo) => repo.entry),
      runtime: runtimeSnapshotFromOpened(
        opened,
        activeRepoRootForOpened(input.activeRepoRoot, opened),
        projectedTabs.snapshots,
      ),
    },
  }
}

function readableWorkspace(probe: WorkspaceProbeState): boolean {
  return probe.status === 'ready'
}

function reconcileOpenedRepoMemberships(
  input: RestoreServerWorkspaceInput,
  entries: readonly WorkspaceSessionEntry[],
  openedByRoot: Map<string, OpenedWorkspaceRepo>,
): void {
  const expectedByRoot = new Map(entries.map((entry) => [workspaceSessionEntryId(entry), entry]))
  for (const [repoRoot, opened] of openedByRoot) {
    const expected = expectedByRoot.get(repoRoot)
    if (sameWorkspaceSessionEntry(opened.entry, expected)) continue
    releaseWorkspaceRepoRuntime(input, opened.lease)
    openedByRoot.delete(repoRoot)
  }
}

async function openWorkspaceRepo(
  input: RestoreServerWorkspaceInput,
  entry: WorkspaceSessionEntry,
  options: { active: boolean },
): Promise<OpenWorkspaceRepoResult> {
  input.signal?.throwIfAborted()
  if (!parseWorkspaceLocator(entry.id, serverLocatorPlatform())) return { kind: 'invalid' }
  if (entry.kind === 'remote') return await openRemoteWorkspaceRepo(input, entry, options)
  return await withAcquiredWorkspaceRepoLease(input, entry.id, async (lease) => {
    let authoritativeProbe = workspaceProbeStateForRuntime(input.userId, entry.id, lease.repoRuntimeId)
    if (authoritativeProbe?.status === 'probing') {
      authoritativeProbe = await runSerializedInitialWorkspaceProbe({
        userId: input.userId,
        repoRoot: entry.id,
        repoRuntimeId: lease.repoRuntimeId,
        probe: async () => await probeWorkspace(entry.id, serverLocatorPlatform(), { signal: input.signal }),
        beforeCommit: async ({ before, after }) => {
          if (!workspaceGitCleanupRequired(before, after)) return
          await removeGitScopedResources(input, entry.id, lease.repoRuntimeId)
        },
      })
    }
    if (!authoritativeProbe) {
      throw new Error('workspace runtime was superseded during restore')
    }
    const name = authoritativeProbe.status === 'ready' ? authoritativeProbe.name : workspaceRepoDisplayName(entry.id)
    if (
      authoritativeProbe.status !== 'ready' ||
      authoritativeProbe.capabilities.git.status === 'unavailable' ||
      !options.active
    ) {
      return {
        kind: 'opened',
        opened: stubWorkspaceRepo({
          entry,
          repoRoot: entry.id,
          name,
          workspaceProbe: authoritativeProbe,
          lease,
        }),
      }
    }
    const projection = await readRepoProjection(entry.id, {
      repoRuntimeId: lease.repoRuntimeId,
      signal: input.signal,
      mode: 'full',
    })
    if (!projection.snapshot) {
      return {
        kind: 'opened',
        opened: stubWorkspaceRepo({
          entry,
          repoRoot: entry.id,
          name,
          workspaceProbe: authoritativeProbe,
          lease,
        }),
      }
    }
    return {
      kind: 'opened',
      opened: projectedWorkspaceRepo({
        entry,
        repoRoot: entry.id,
        name,
        workspaceProbe: authoritativeProbe,
        projection,
        lease,
      }),
    }
  })
}

async function openRemoteWorkspaceRepo(
  input: RestoreServerWorkspaceInput,
  entry: RemoteWorkspaceSessionEntry,
  options: { active: boolean },
): Promise<OpenWorkspaceRepoResult> {
  return await withAcquiredWorkspaceRepoLease(input, entry.id, async (lease) => {
    const lifecycle = await abortableWorkspaceRestore(
      runRemoteLifecycleWrite(
        {
          userId: input.userId,
          repoId: entry.id,
          repoRuntimeId: lease.repoRuntimeId,
          mode: 'ensure',
        },
        remoteCapabilityTransitionOptions(input, entry.id, lease.repoRuntimeId),
      ),
      input.signal,
    )
    if (lifecycle.kind !== 'settled' || lifecycle.lifecycle.kind !== 'ready') {
      if (lifecycle.kind === 'settled') {
        return {
          kind: 'opened',
          opened: stubWorkspaceRepo({
            entry,
            repoRoot: entry.id,
            name: lifecycle.name,
            workspaceProbe: requiredWorkspaceProbe(input.userId, entry.id, lease.repoRuntimeId),
            lease,
          }),
        }
      }
      throw new Error('workspace repo runtime was superseded during restore')
    }
    const workspaceProbe = requiredWorkspaceProbe(input.userId, entry.id, lease.repoRuntimeId)
    if (
      workspaceProbe.status !== 'ready' ||
      workspaceProbe.capabilities.git.status === 'unavailable' ||
      !options.active
    ) {
      return {
        kind: 'opened',
        opened: stubWorkspaceRepo({
          entry,
          repoRoot: entry.id,
          name: lifecycle.name,
          target: lifecycle.lifecycle.target,
          workspaceProbe,
          lease,
        }),
      }
    }
    const projection = await readRepoProjection(entry.id, {
      repoRuntimeId: lease.repoRuntimeId,
      signal: input.signal,
      mode: 'full',
    })
    if (!projection.snapshot) {
      return {
        kind: 'opened',
        opened: stubWorkspaceRepo({
          entry,
          repoRoot: entry.id,
          name: lifecycle.name,
          target: lifecycle.lifecycle.target,
          workspaceProbe,
          lease,
        }),
      }
    }
    return {
      kind: 'opened',
      opened: projectedWorkspaceRepo({
        entry,
        repoRoot: entry.id,
        name: lifecycle.name,
        target: lifecycle.lifecycle.target,
        workspaceProbe,
        projection,
        lease,
      }),
    }
  })
}

function remoteCapabilityTransitionOptions(
  input: RestoreServerWorkspaceInput,
  workspaceId: string,
  workspaceRuntimeId: string,
) {
  return {
    beforeCapabilityCommit: async ({
      before,
      after,
    }: {
      before: WorkspaceProbeState
      after: WorkspaceSettledProbeState
    }) => {
      if (!workspaceGitCleanupRequired(before, after)) return
      await removeGitScopedResources(input, workspaceId, workspaceRuntimeId)
    },
  }
}

async function removeGitScopedResources(
  input: RestoreServerWorkspaceInput,
  workspaceId: string,
  workspaceRuntimeId: string,
): Promise<void> {
  await input.workspaceCapabilityTransitionHost.removeGitScopedResources({
    userId: input.userId,
    workspaceId,
    workspaceRuntimeId,
    assertCurrent: () => {
      if (!isCurrentRepoRuntimeMembership(input.userId, workspaceId, workspaceRuntimeId, input.clientId)) {
        throw new Error('error.repo-runtime-stale')
      }
    },
  })
}

async function withAcquiredWorkspaceRepoLease<T>(
  input: RestoreServerWorkspaceInput,
  repoRoot: string,
  open: (lease: RepoRuntimeMembershipLeaseEntry) => Promise<T>,
): Promise<T> {
  const lease = acquireRepoRuntimeLease(input.userId, repoRoot, input.clientId)
  try {
    return await open(lease)
  } catch (err) {
    releaseWorkspaceRepoRuntime(input, lease)
    throw err
  }
}

interface OpenedWorkspaceRepoInput {
  entry: WorkspaceSessionEntry
  repoRoot: string
  name: string
  target?: RemoteRepoTarget
  workspaceProbe: WorkspaceProbeState
  lease: RepoRuntimeMembershipLeaseEntry
}

function requiredWorkspaceProbe(userId: string, repoRoot: string, repoRuntimeId: string): WorkspaceProbeState {
  const probe = workspaceProbeStateForRuntime(userId, repoRoot, repoRuntimeId)
  if (!probe) throw new Error('workspace runtime was superseded during restore')
  return probe
}

function serverLocatorPlatform(): 'posix' | 'win32' {
  return process.platform === 'win32' ? 'win32' : 'posix'
}

function stubWorkspaceRepo(input: OpenedWorkspaceRepoInput): OpenedWorkspaceRepo {
  return {
    ...input,
    repoRuntimeId: input.lease.repoRuntimeId,
    projection: null,
  }
}

function projectedWorkspaceRepo(
  input: OpenedWorkspaceRepoInput & { projection: RepoRuntimeProjection },
): OpenedWorkspaceRepo {
  return {
    ...input,
    repoRuntimeId: input.lease.repoRuntimeId,
  }
}

function isOpenedProjectedRepo(repo: OpenedWorkspaceRepo): repo is OpenedProjectedWorkspaceRepo {
  return isProjectedRestoredWorkspaceRepo(repo)
}

function activeRepoRootForOpened(
  activeRepoRoot: string | null | undefined,
  opened: OpenedWorkspaceRepo[],
): string | null {
  if (activeRepoRoot && opened.some((repo) => repo.repoRoot === activeRepoRoot)) return activeRepoRoot
  return opened[0]?.repoRoot ?? null
}

function openedRepoByRoot<T extends RestoredWorkspaceRepoRuntime>(opened: T[]): Map<string, T> {
  return new Map(opened.map((repo) => [repo.repoRoot, repo]))
}

function runtimeSnapshotFromOpened(
  opened: OpenedWorkspaceRepo[],
  restoredRepoId: string | null,
  workspacePaneTabs: Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }>,
): WorkspaceRuntimeRestoreSnapshot {
  return {
    repos: opened.map((repo) => omit(repo, ['lease'])),
    workspacePaneTabs,
    restoredRepoId,
  }
}

function releaseOpenedRepoRuntimes(input: RestoreServerWorkspaceInput, opened: Iterable<OpenedWorkspaceRepo>): void {
  for (const repo of opened) releaseWorkspaceRepoRuntime(input, repo.lease)
}

function releaseWorkspaceRepoRuntime(input: RestoreServerWorkspaceInput, lease: RepoRuntimeMembershipLeaseEntry): void {
  releaseRepoRuntimeMembershipLease(input.userId, input.clientId, lease)
}
