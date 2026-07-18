import { IpcError, type RestoredWorkspaceRuntime, type WorkspaceTabsRestoreResult } from '#/shared/api-types.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import { readRepoProjection } from '#/server/modules/repo-read-paths.ts'
import {
  isCurrentWorkspaceRuntimeMembership,
  runSerializedInitialWorkspaceProbe,
  workspaceProbeStateForRuntime,
  isCurrentWorkspaceRuntime,
} from '#/server/modules/workspace-runtimes.ts'
import { runRemoteWorkspaceLifecycleWrite } from '#/server/modules/remote-workspace-lifecycle-write-paths.ts'
import { confirmServerWorkspaceEntry, getServerWorkspaceState } from '#/server/modules/settings-source.ts'
import {
  projectWorkspacePaneTabsWithMembershipGuard,
  workspaceEntry,
} from '#/server/modules/workspace-pane-tabs-restore.ts'
import { abortableWorkspaceRestore, workspaceDisplayName } from '#/server/modules/workspace-restore-utils.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import { probeWorkspace } from '#/server/modules/workspace-probe.ts'
import {
  commitGitCapabilityRemovalOrThrow,
  type WorkspaceCapabilityTransitionHost,
} from '#/server/workspace-capability-transition-host.ts'
import { workspaceGitCleanupRequired } from '#/server/modules/workspace-capability-transition.ts'
import type { WorkspaceProbeState, WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

interface RestoreWorkspaceTabsInput {
  userId: string
  clientId: string
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost
  signal?: AbortSignal
}

export async function restoreWorkspaceTabs(input: RestoreWorkspaceTabsInput): Promise<WorkspaceTabsRestoreResult> {
  input.signal?.throwIfAborted()
  assertCurrentWorkspaceRuntimeMembership(input)
  const initialWorkspace = await getServerWorkspaceState()
  assertCurrentWorkspaceRuntimeMembership(input)
  const entry = workspaceEntry(initialWorkspace, input.workspaceId)
  if (!entry) throw workspaceNotInSession()
  const workspace = await projectWorkspace(input, entry)
  if (!workspace) throw new IpcError({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })

  const projectedTabs = await projectWorkspacePaneTabsWithMembershipGuard({
    restoreInput: input,
    workspaces: [workspace],
    confirmMembership: async () => await confirmServerWorkspaceEntry(entry),
    membershipPolicy: 'transaction-authoritative',
    assertCurrent: () => assertCurrentWorkspaceRuntimeMembership(input),
  })
  if (!projectedTabs.matched) throw workspaceNotInSession()
  return { workspace, snapshot: projectedTabs.snapshots[0]?.snapshot ?? null }
}

async function projectWorkspace(
  input: RestoreWorkspaceTabsInput,
  entry: WorkspaceSessionEntry,
): Promise<RestoredWorkspaceRuntime | null> {
  if (entry.kind === 'remote') {
    const lifecycle = await abortableWorkspaceRestore(
      runRemoteWorkspaceLifecycleWrite(
        {
          userId: input.userId,
          workspaceId: entry.id,
          workspaceRuntimeId: input.workspaceRuntimeId,
          mode: 'ensure',
        },
        {
          beforeCapabilityCommit: async ({ before, after }) => {
            if (!workspaceGitCleanupRequired(before, after)) return
            await commitGitCapabilityRemovalOrThrow(input.workspaceCapabilityTransitionHost, {
              userId: input.userId,
              workspaceId: entry.id,
              workspaceRuntimeId: input.workspaceRuntimeId,
              assertCurrent: () => {
                if (!isCurrentWorkspaceRuntime(input.userId, entry.id, input.workspaceRuntimeId)) {
                  throw new Error('error.workspace-runtime-stale')
                }
              },
            })
          },
        },
      ),
      input.signal,
    )
    assertCurrentWorkspaceRuntimeMembership(input)
    if (lifecycle.kind !== 'settled' || lifecycle.lifecycle.kind !== 'ready') return null
    const workspaceProbe = workspaceProbeStateForRuntime(input.userId, entry.id, input.workspaceRuntimeId)
    if (!workspaceProbe || workspaceProbe.status !== 'ready') return null
    if (workspaceProbe.capabilities.git.status === 'unavailable') {
      return {
        entry,
        workspaceId: entry.id,
        workspaceRuntimeId: input.workspaceRuntimeId,
        name: lifecycle.name,
        target: lifecycle.lifecycle.target,
        workspaceProbe,
        projection: null,
      }
    }
    const projection = await readRepoProjection(entry.id, {
      workspaceRuntimeId: input.workspaceRuntimeId,
      signal: input.signal,
      mode: 'full',
    })
    assertCurrentWorkspaceRuntimeMembership(input)
    if (!projection.snapshot) return null
    return {
      entry,
      workspaceId: entry.id,
      workspaceRuntimeId: input.workspaceRuntimeId,
      name: lifecycle.name,
      target: lifecycle.lifecycle.target,
      workspaceProbe,
      projection,
    }
  }
  let probe = workspaceProbeStateForRuntime(input.userId, entry.id, input.workspaceRuntimeId)
  if (!probe) return null
  if (probe.status === 'probing') {
    const authoritativeProbe = await runSerializedInitialWorkspaceProbe({
      userId: input.userId,
      workspaceId: entry.id,
      workspaceRuntimeId: input.workspaceRuntimeId,
      probe: async () =>
        await probeWorkspace(entry.id, process.platform === 'win32' ? 'win32' : 'posix', {
          signal: input.signal,
        }),
      beforeCommit: async ({ before, after }) => {
        if (!workspaceGitCleanupRequired(before, after)) return
        await commitGitCapabilityRemovalOrThrow(input.workspaceCapabilityTransitionHost, {
          userId: input.userId,
          workspaceId: entry.id,
          workspaceRuntimeId: input.workspaceRuntimeId,
          assertCurrent: () => assertCurrentWorkspaceRuntimeMembership(input),
        })
      },
    })
    if (!authoritativeProbe) return null
    probe = authoritativeProbe
  }
  if (probe.status !== 'ready') return null
  if (probe.capabilities.git.status === 'unavailable') {
    return {
      entry,
      workspaceId: entry.id,
      workspaceRuntimeId: input.workspaceRuntimeId,
      name: probe.name ?? workspaceDisplayName(entry.id),
      workspaceProbe: probe,
      projection: null,
    }
  }
  const projection = await readRepoProjection(entry.id, {
    workspaceRuntimeId: input.workspaceRuntimeId,
    signal: input.signal,
    mode: 'full',
  })
  assertCurrentWorkspaceRuntimeMembership(input)
  if (!projection.snapshot) return null
  return {
    entry,
    workspaceId: entry.id,
    workspaceRuntimeId: input.workspaceRuntimeId,
    name: probe.name ?? workspaceDisplayName(entry.id),
    workspaceProbe: probe,
    projection,
  }
}

function assertCurrentWorkspaceRuntimeMembership(input: RestoreWorkspaceTabsInput): void {
  if (isCurrentWorkspaceRuntimeMembership(input.userId, input.workspaceId, input.workspaceRuntimeId, input.clientId))
    return
  throw new IpcError({ code: 'BAD_REQUEST', message: 'error.workspace-runtime-stale' })
}

function workspaceNotInSession(): IpcError {
  return new IpcError({ code: 'NOT_FOUND', message: 'error.workspace-not-in-session' })
}
