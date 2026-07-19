import PQueue from 'p-queue'
import { omit } from 'es-toolkit'
import {
  isProjectedRestoredWorkspaceRuntime,
  type ProjectedRestoredWorkspaceRuntime,
  type WorkspaceRuntimeProjection,
  type RestoredWorkspaceRuntime,
  type WorkspaceRestoreResult,
  type WorkspaceRuntimeRestoreSnapshot,
  type ServerWorkspaceState,
} from '#/shared/api-types.ts'
import {
  workspaceSessionEntryId,
  sameWorkspaceSessionEntry,
  type RemoteWorkspaceSessionEntry,
  type RemoteWorkspaceTarget,
  type WorkspaceSessionEntry,
} from '#/shared/remote-workspace.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import { readRepoProjection } from '#/server/modules/repo-read-paths.ts'
import {
  acquireWorkspaceRuntimeLease,
  isCurrentWorkspaceRuntimeMembership,
  releaseWorkspaceRuntimeMembershipLease,
  runSerializedInitialWorkspaceProbe,
  workspaceProbeStateForRuntime,
  type WorkspaceRuntimeMembershipLeaseEntry,
} from '#/server/modules/workspace-runtimes.ts'
import { probeWorkspace } from '#/server/modules/workspace-probe.ts'
import type { WorkspaceProbeState, WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'
import { parseWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { runRemoteWorkspaceLifecycleWrite } from '#/server/modules/remote-workspace-lifecycle-write-paths.ts'
import { compareAndReplaceServerWorkspaceEntries, getServerWorkspaceState } from '#/server/modules/settings-source.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import { abortableWorkspaceRestore, workspaceDisplayName } from '#/server/modules/workspace-restore-utils.ts'
import { projectWorkspacePaneTabsWithMembershipGuard } from '#/server/modules/workspace-pane-tabs-restore.ts'
import {
  commitGitCapabilityRemovalOrThrow,
  type WorkspaceCapabilityTransitionHost,
} from '#/server/workspace-capability-transition-host.ts'
import { workspaceGitCleanupRequired } from '#/server/modules/workspace-capability-transition.ts'

export interface RestoreServerWorkspaceInput {
  userId: string
  clientId: string
  // The workspace the user is currently viewing. Only this workspace gets the
  // full projection read + pane-tab restore at cold start. Other workspaces are
  // validated/canonicalized, then returned as stub leases and restored lazily
  // when the user navigates to them.
  activeWorkspaceId?: WorkspaceId | null
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost
  signal?: AbortSignal
}

type OpenWorkspaceResult = { kind: 'opened'; opened: OpenedWorkspaceRuntime } | { kind: 'invalid' }
type OpenedWorkspaceRuntime = RestoredWorkspaceRuntime & {
  lease: WorkspaceRuntimeMembershipLeaseEntry
}
type OpenedProjectedWorkspace = ProjectedRestoredWorkspaceRuntime & {
  lease: WorkspaceRuntimeMembershipLeaseEntry
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
        activeWorkspaceId: input.activeWorkspaceId ?? workspace.openWorkspaceEntries[0]?.id ?? null,
      }
      const openedByWorkspaceId = new Map<WorkspaceId, OpenedWorkspaceRuntime>()
      let repaired = false
      let committed = false
      try {
        for (let conflicts = 0; ; conflicts += 1) {
          const outcome = await restoreServerWorkspaceSnapshot(restoreInput, workspace, openedByWorkspaceId)
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
        if (!committed) releaseOpenedWorkspaceRuntimes(input, openedByWorkspaceId.values())
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
  openedByWorkspaceId: Map<WorkspaceId, OpenedWorkspaceRuntime>,
): Promise<RestoreServerWorkspaceSnapshotOutcome> {
  input.signal?.throwIfAborted()
  let workspaceRestoreFailed = false
  const activeWorkspaceId = input.activeWorkspaceId ?? null
  reconcileOpenedWorkspaceMemberships(input, source.openWorkspaceEntries, openedByWorkspaceId)
  for (const entry of source.openWorkspaceEntries) {
    if (openedByWorkspaceId.has(workspaceSessionEntryId(entry))) continue
    const result = await openWorkspaceRuntime(input, entry, {
      active: workspaceSessionEntryId(entry) === activeWorkspaceId,
    })
    if (result.kind === 'invalid') {
      workspaceRestoreFailed = true
      continue
    }
    openedByWorkspaceId.set(result.opened.workspaceId, result.opened)
  }

  input.signal?.throwIfAborted()
  const opened = source.openWorkspaceEntries.flatMap((entry) => {
    const workspace = openedByWorkspaceId.get(workspaceSessionEntryId(entry))
    return workspace ? [workspace] : []
  })
  const membership = await compareAndReplaceServerWorkspaceEntries(
    source.openWorkspaceEntries,
    opened.map((workspace) => workspace.entry),
  )
  if (!membership.matched) {
    return { kind: 'membership-conflict', latestWorkspace: membership.latestWorkspace, repaired: false }
  }

  // Only the active workspace's tabs are validated and restored at startup.
  // Non-active workspaces carry `projection: null` and are restored lazily.
  const openedForLayoutRestore = opened.filter(
    (workspace) => isOpenedProjectedWorkspace(workspace) || readableWorkspace(workspace.workspaceProbe),
  )
  const expectedMembership = membership.workspace.openWorkspaceEntries
  const projectedTabs = await projectWorkspacePaneTabsWithMembershipGuard({
    restoreInput: input,
    workspaces: openedForLayoutRestore,
    confirmMembership: async () =>
      await compareAndReplaceServerWorkspaceEntries(expectedMembership, expectedMembership),
    membershipPolicy: 'confirm-after-restore',
  })
  if (!projectedTabs.matched) {
    return {
      kind: 'membership-conflict',
      latestWorkspace: projectedTabs.latestWorkspace,
      repaired: workspaceRestoreFailed,
    }
  }
  return {
    kind: 'restored',
    value: {
      status: workspaceRestoreFailed || projectedTabs.repaired ? 'repaired' : 'restored',
      openWorkspaceEntries: opened.map((workspace) => workspace.entry),
      runtime: runtimeSnapshotFromOpened(
        opened,
        activeWorkspaceIdForOpened(input.activeWorkspaceId, opened),
        projectedTabs.snapshots,
      ),
    },
  }
}

function readableWorkspace(probe: WorkspaceProbeState): boolean {
  return probe.status === 'ready'
}

function reconcileOpenedWorkspaceMemberships(
  input: RestoreServerWorkspaceInput,
  entries: readonly WorkspaceSessionEntry[],
  openedByWorkspaceId: Map<WorkspaceId, OpenedWorkspaceRuntime>,
): void {
  const expectedByWorkspaceId = new Map(entries.map((entry) => [workspaceSessionEntryId(entry), entry]))
  for (const [workspaceId, opened] of openedByWorkspaceId) {
    const expected = expectedByWorkspaceId.get(workspaceId)
    if (sameWorkspaceSessionEntry(opened.entry, expected)) continue
    releaseWorkspaceRuntimeLease(input, opened.lease)
    openedByWorkspaceId.delete(workspaceId)
  }
}

async function openWorkspaceRuntime(
  input: RestoreServerWorkspaceInput,
  entry: WorkspaceSessionEntry,
  options: { active: boolean },
): Promise<OpenWorkspaceResult> {
  input.signal?.throwIfAborted()
  if (!parseWorkspaceLocator(entry.id, serverLocatorPlatform())) return { kind: 'invalid' }
  if (entry.kind === 'remote') return await openRemoteWorkspace(input, entry, options)
  return await withAcquiredWorkspaceRuntimeLease(input, entry.id, async (lease) => {
    let authoritativeProbe = workspaceProbeStateForRuntime(input.userId, entry.id, lease.workspaceRuntimeId)
    if (authoritativeProbe?.status === 'probing') {
      authoritativeProbe = await runSerializedInitialWorkspaceProbe({
        userId: input.userId,
        workspaceId: entry.id,
        workspaceRuntimeId: lease.workspaceRuntimeId,
        probe: async () => await probeWorkspace(entry.id, serverLocatorPlatform(), { signal: input.signal }),
        beforeCommit: async ({ before, after }) => {
          if (!workspaceGitCleanupRequired(before, after)) return
          await commitGitCapabilityRemoval(input, entry.id, lease.workspaceRuntimeId)
        },
      })
    }
    if (!authoritativeProbe) {
      throw new Error('workspace runtime was superseded during restore')
    }
    const name = authoritativeProbe.status === 'ready' ? authoritativeProbe.name : workspaceDisplayName(entry.id)
    if (
      authoritativeProbe.status !== 'ready' ||
      authoritativeProbe.capabilities.git.status === 'unavailable' ||
      !options.active
    ) {
      return {
        kind: 'opened',
        opened: stubWorkspace({
          entry,
          workspaceId: lease.workspaceId,
          name,
          workspaceProbe: authoritativeProbe,
          lease,
        }),
      }
    }
    const projection = await readRepoProjection(entry.id, {
      workspaceRuntimeId: lease.workspaceRuntimeId,
      signal: input.signal,
      mode: 'full',
    })
    if (!projection.snapshot) {
      return {
        kind: 'opened',
        opened: stubWorkspace({
          entry,
          workspaceId: lease.workspaceId,
          name,
          workspaceProbe: authoritativeProbe,
          lease,
        }),
      }
    }
    return {
      kind: 'opened',
      opened: projectedWorkspace({
        entry,
        workspaceId: lease.workspaceId,
        name,
        workspaceProbe: authoritativeProbe,
        projection,
        lease,
      }),
    }
  })
}

async function openRemoteWorkspace(
  input: RestoreServerWorkspaceInput,
  entry: RemoteWorkspaceSessionEntry,
  options: { active: boolean },
): Promise<OpenWorkspaceResult> {
  return await withAcquiredWorkspaceRuntimeLease(input, entry.id, async (lease) => {
    const lifecycle = await abortableWorkspaceRestore(
      runRemoteWorkspaceLifecycleWrite(
        {
          userId: input.userId,
          workspaceId: entry.id,
          workspaceRuntimeId: lease.workspaceRuntimeId,
          mode: 'ensure',
        },
        remoteCapabilityTransitionOptions(input, entry.id, lease.workspaceRuntimeId),
      ),
      input.signal,
    )
    if (lifecycle.kind !== 'settled' || lifecycle.lifecycle.kind !== 'ready') {
      if (lifecycle.kind === 'settled') {
        return {
          kind: 'opened',
          opened: stubWorkspace({
            entry,
            workspaceId: lease.workspaceId,
            name: lifecycle.name,
            workspaceProbe: requiredWorkspaceProbe(input.userId, entry.id, lease.workspaceRuntimeId),
            lease,
          }),
        }
      }
      throw new Error('workspace workspace runtime was superseded during restore')
    }
    const workspaceProbe = requiredWorkspaceProbe(input.userId, entry.id, lease.workspaceRuntimeId)
    if (
      workspaceProbe.status !== 'ready' ||
      workspaceProbe.capabilities.git.status === 'unavailable' ||
      !options.active
    ) {
      return {
        kind: 'opened',
        opened: stubWorkspace({
          entry,
          workspaceId: lease.workspaceId,
          name: lifecycle.name,
          target: lifecycle.lifecycle.target,
          workspaceProbe,
          lease,
        }),
      }
    }
    const projection = await readRepoProjection(entry.id, {
      workspaceRuntimeId: lease.workspaceRuntimeId,
      signal: input.signal,
      mode: 'full',
    })
    if (!projection.snapshot) {
      return {
        kind: 'opened',
        opened: stubWorkspace({
          entry,
          workspaceId: lease.workspaceId,
          name: lifecycle.name,
          target: lifecycle.lifecycle.target,
          workspaceProbe,
          lease,
        }),
      }
    }
    return {
      kind: 'opened',
      opened: projectedWorkspace({
        entry,
        workspaceId: lease.workspaceId,
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
  workspaceId: WorkspaceId,
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
      await commitGitCapabilityRemoval(input, workspaceId, workspaceRuntimeId)
    },
  }
}

async function commitGitCapabilityRemoval(
  input: RestoreServerWorkspaceInput,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): Promise<void> {
  await commitGitCapabilityRemovalOrThrow(input.workspaceCapabilityTransitionHost, {
    userId: input.userId,
    workspaceId,
    workspaceRuntimeId,
    assertCurrent: () => {
      if (!isCurrentWorkspaceRuntimeMembership(input.userId, workspaceId, workspaceRuntimeId, input.clientId)) {
        throw new Error('error.workspace-runtime-stale')
      }
    },
  })
}

async function withAcquiredWorkspaceRuntimeLease<T>(
  input: RestoreServerWorkspaceInput,
  workspaceId: WorkspaceId,
  open: (lease: WorkspaceRuntimeMembershipLeaseEntry) => Promise<T>,
): Promise<T> {
  const lease = acquireWorkspaceRuntimeLease(input.userId, workspaceId, input.clientId)
  try {
    return await open(lease)
  } catch (err) {
    releaseWorkspaceRuntimeLease(input, lease)
    throw err
  }
}

interface OpenedWorkspaceRuntimeInput {
  entry: WorkspaceSessionEntry
  workspaceId: WorkspaceId
  name: string
  target?: RemoteWorkspaceTarget
  workspaceProbe: WorkspaceProbeState
  lease: WorkspaceRuntimeMembershipLeaseEntry
}

function requiredWorkspaceProbe(
  userId: string,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): WorkspaceProbeState {
  const probe = workspaceProbeStateForRuntime(userId, workspaceId, workspaceRuntimeId)
  if (!probe) throw new Error('workspace runtime was superseded during restore')
  return probe
}

function serverLocatorPlatform(): 'posix' | 'win32' {
  return process.platform === 'win32' ? 'win32' : 'posix'
}

function stubWorkspace(input: OpenedWorkspaceRuntimeInput): OpenedWorkspaceRuntime {
  return {
    ...input,
    workspaceRuntimeId: input.lease.workspaceRuntimeId,
    projection: null,
  }
}

function projectedWorkspace(
  input: OpenedWorkspaceRuntimeInput & { projection: WorkspaceRuntimeProjection },
): OpenedWorkspaceRuntime {
  return {
    ...input,
    workspaceRuntimeId: input.lease.workspaceRuntimeId,
  }
}

function isOpenedProjectedWorkspace(workspace: OpenedWorkspaceRuntime): workspace is OpenedProjectedWorkspace {
  return isProjectedRestoredWorkspaceRuntime(workspace)
}

function activeWorkspaceIdForOpened(
  activeWorkspaceId: WorkspaceId | null | undefined,
  opened: OpenedWorkspaceRuntime[],
): WorkspaceId | null {
  const activeWorkspace = activeWorkspaceId
    ? opened.find((workspace) => workspace.workspaceId === activeWorkspaceId)
    : null
  if (activeWorkspace) return activeWorkspace.workspaceId
  return opened[0]?.workspaceId ?? null
}

function runtimeSnapshotFromOpened(
  opened: OpenedWorkspaceRuntime[],
  restoredWorkspaceId: WorkspaceId | null,
  workspacePaneTabs: Array<{
    workspaceId: WorkspaceId
    workspaceRuntimeId: string
    snapshot: WorkspacePaneTabsSnapshot
  }>,
): WorkspaceRuntimeRestoreSnapshot {
  return {
    workspaces: opened.map((workspace) => omit(workspace, ['lease'])),
    workspacePaneTabs,
    restoredWorkspaceId,
  }
}

function releaseOpenedWorkspaceRuntimes(
  input: RestoreServerWorkspaceInput,
  opened: Iterable<OpenedWorkspaceRuntime>,
): void {
  for (const workspace of opened) releaseWorkspaceRuntimeLease(input, workspace.lease)
}

function releaseWorkspaceRuntimeLease(
  input: RestoreServerWorkspaceInput,
  lease: WorkspaceRuntimeMembershipLeaseEntry,
): void {
  releaseWorkspaceRuntimeMembershipLease(input.userId, input.clientId, lease)
}
