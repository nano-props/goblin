import PQueue from 'p-queue'
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
  repoSessionEntryId,
  sameRepoSessionEntry,
  type RemoteRepoSessionEntry,
  type RemoteRepoTarget,
  type RepoSessionEntry,
} from '#/shared/remote-repo.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import { probeRepo, readRepoProjection } from '#/server/modules/repo-read-paths.ts'
import {
  acquireRepoRuntimeLease,
  releaseRepoRuntimeMembershipLease,
  type RepoRuntimeMembershipLeaseEntry,
} from '#/server/modules/repo-runtimes.ts'
import { runRemoteLifecycleWrite } from '#/server/modules/remote-lifecycle-write-paths.ts'
import { compareAndReplaceServerWorkspaceRepos, getServerWorkspaceState } from '#/server/modules/settings-source.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import { abortableWorkspaceRestore, workspaceRepoDisplayName } from '#/server/modules/workspace-restore-utils.ts'
import {
  initializeWorkspacePaneTabsWithMembershipGuard,
} from '#/server/modules/workspace-pane-tabs-restore.ts'

export interface RestoreServerWorkspaceInput {
  userId: string
  clientId: string
  // The repo the user is currently viewing. Only this repo gets the full
  // projection read + pane-tab restore at cold start. Other repos are
  // validated/canonicalized, then returned as stub leases and restored lazily
  // when the user navigates to them.
  activeRepoRoot?: string | null
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
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
        activeRepoRoot: input.activeRepoRoot ?? workspace.openRepoEntries[0]?.id ?? null,
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
  reconcileOpenedRepoMemberships(input, source.openRepoEntries, openedByRoot)
  for (const entry of source.openRepoEntries) {
    if (openedByRoot.has(repoSessionEntryId(entry))) continue
    const result = await openWorkspaceRepo(input, entry, {
      active: repoSessionEntryId(entry) === activeRepoRoot,
    })
    if (result.kind === 'invalid') {
      repoRestoreFailed = true
      continue
    }
    openedByRoot.set(result.opened.repoRoot, result.opened)
  }

  input.signal?.throwIfAborted()
  const opened = source.openRepoEntries.flatMap((entry) => {
    const repo = openedByRoot.get(repoSessionEntryId(entry))
    return repo ? [repo] : []
  })
  const membership = await compareAndReplaceServerWorkspaceRepos(
    source.openRepoEntries,
    opened.map((repo) => repo.entry),
  )
  if (!membership.matched) {
    return { kind: 'membership-conflict', latestWorkspace: membership.latestWorkspace, repaired: false }
  }

  // Only the active repo's tabs are validated and restored at startup.
  // Non-active repos carry `projection: null` and are restored lazily.
  const openedActive = opened.filter(isOpenedProjectedRepo)
  const expectedMembership = membership.workspace.openRepoEntries
  const initializedTabs = await initializeWorkspacePaneTabsWithMembershipGuard({
    restoreInput: input,
    workspace: membership.workspace,
    repos: openedActive,
    confirmMembership: async () => await compareAndReplaceServerWorkspaceRepos(expectedMembership, expectedMembership),
  })
  if (!initializedTabs.matched) {
    return {
      kind: 'membership-conflict',
      latestWorkspace: initializedTabs.latestWorkspace,
      repaired: repoRestoreFailed,
    }
  }
  return {
    kind: 'restored',
    value: {
      status: repoRestoreFailed ? 'repaired' : 'restored',
      openRepoEntries: opened.map((repo) => repo.entry),
      runtime: runtimeSnapshotFromOpened(
        opened,
        activeRepoRootForOpened(input.activeRepoRoot, opened),
        initializedTabs.snapshots,
      ),
    },
  }
}

function reconcileOpenedRepoMemberships(
  input: RestoreServerWorkspaceInput,
  entries: readonly RepoSessionEntry[],
  openedByRoot: Map<string, OpenedWorkspaceRepo>,
): void {
  const expectedByRoot = new Map(entries.map((entry) => [repoSessionEntryId(entry), entry]))
  for (const [repoRoot, opened] of openedByRoot) {
    const expected = expectedByRoot.get(repoRoot)
    if (sameRepoSessionEntry(opened.entry, expected)) continue
    releaseWorkspaceRepoRuntime(input, opened.lease)
    openedByRoot.delete(repoRoot)
  }
}

async function openWorkspaceRepo(
  input: RestoreServerWorkspaceInput,
  entry: RepoSessionEntry,
  options: { active: boolean },
): Promise<OpenWorkspaceRepoResult> {
  input.signal?.throwIfAborted()
  if (entry.kind === 'remote') return await openRemoteWorkspaceRepo(input, entry, options)
  const probe = await probeRepo(entry.id)
  if (!probe.ok || !probe.root) {
    const lease = acquireRepoRuntimeLease(input.userId, entry.id, input.clientId)
    return {
      kind: 'opened',
      opened: stubWorkspaceRepo({
        entry,
        repoRoot: entry.id,
        name: workspaceRepoDisplayName(entry.id),
        lease,
      }),
    }
  }
  if (probe.root !== entry.id) return { kind: 'invalid' }
  const repoRoot = probe.root
  return await withAcquiredWorkspaceRepoLease(input, repoRoot, async (lease) => {
    if (!options.active) {
      // Stub path: validated lease only. No projection read or pane-tab restore.
      // Persisted local entries must already be canonical; this branch refuses to
      // migrate non-canonical paths and lets workspace repair clean them.
      return {
        kind: 'opened',
        opened: stubWorkspaceRepo({
          entry: { kind: 'local', id: repoRoot },
          repoRoot,
          name: probe.name ?? workspaceRepoDisplayName(repoRoot),
          lease,
        }),
      }
    }
    const projection = await readRepoProjection(repoRoot, {
      repoRuntimeId: lease.repoRuntimeId,
      signal: input.signal,
      mode: 'full',
    })
    if (!projection.snapshot) {
      return {
        kind: 'opened',
        opened: stubWorkspaceRepo({
          entry: { kind: 'local', id: repoRoot },
          repoRoot,
          name: probe.name ?? workspaceRepoDisplayName(repoRoot),
          lease,
        }),
      }
    }
    return {
      kind: 'opened',
      opened: projectedWorkspaceRepo({
        entry: { kind: 'local', id: repoRoot },
        repoRoot,
        name: probe.name ?? workspaceRepoDisplayName(repoRoot),
        projection,
        lease,
      }),
    }
  })
}

async function openRemoteWorkspaceRepo(
  input: RestoreServerWorkspaceInput,
  entry: RemoteRepoSessionEntry,
  options: { active: boolean },
): Promise<OpenWorkspaceRepoResult> {
  return await withAcquiredWorkspaceRepoLease(input, entry.id, async (lease) => {
    if (!options.active) {
      // Stub path for remote repos: still need a name but no lifecycle / projection.
      return {
        kind: 'opened',
        opened: stubWorkspaceRepo({ entry, repoRoot: entry.id, name: entry.ref.displayName, lease }),
      }
    }
    const lifecycle = await abortableWorkspaceRestore(
      runRemoteLifecycleWrite({
        userId: input.userId,
        repoId: entry.id,
        repoRuntimeId: lease.repoRuntimeId,
        mode: 'ensure',
      }),
      input.signal,
    )
    if (lifecycle.kind !== 'settled' || lifecycle.lifecycle.kind !== 'ready') {
      if (lifecycle.kind === 'settled') {
        return {
          kind: 'opened',
          opened: stubWorkspaceRepo({ entry, repoRoot: entry.id, name: lifecycle.name, lease }),
        }
      }
      throw new Error('workspace repo runtime was superseded during restore')
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
        projection,
        lease,
      }),
    }
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
  entry: RepoSessionEntry
  repoRoot: string
  name: string
  target?: RemoteRepoTarget
  lease: RepoRuntimeMembershipLeaseEntry
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
    repos: opened.map(({ lease: _lease, ...repo }) => repo),
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
