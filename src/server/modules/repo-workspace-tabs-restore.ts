import { IpcError, type RestoredWorkspaceRuntime, type WorkspaceTabsRestoreResult } from '#/shared/api-types.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-repo.ts'
import { readRepoProjection } from '#/server/modules/repo-read-paths.ts'
import {
  isCurrentWorkspaceRuntimeMembership,
  runSerializedInitialWorkspaceProbe,
  workspaceProbeStateForRuntime,
  isCurrentWorkspaceRuntime,
} from '#/server/modules/workspace-runtimes.ts'
import { runRemoteLifecycleWrite } from '#/server/modules/remote-lifecycle-write-paths.ts'
import { confirmServerWorkspaceRepoEntry, getServerWorkspaceState } from '#/server/modules/settings-source.ts'
import {
  projectWorkspacePaneTabsWithMembershipGuard,
  workspaceRepoEntry,
} from '#/server/modules/workspace-pane-tabs-restore.ts'
import { abortableWorkspaceRestore, workspaceRepoDisplayName } from '#/server/modules/workspace-restore-utils.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import { probeWorkspace } from '#/server/modules/workspace-probe.ts'
import {
  commitGitCapabilityRemovalOrThrow,
  type WorkspaceCapabilityTransitionHost,
} from '#/server/workspace-capability-transition-host.ts'
import { workspaceGitCleanupRequired } from '#/server/modules/workspace-capability-transition.ts'
import type { WorkspaceProbeState, WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'

interface RestoreRepoTabsInput {
  userId: string
  clientId: string
  repoRoot: string
  workspaceRuntimeId: string
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost
  signal?: AbortSignal
}

export async function restoreRepoTabsForRepo(input: RestoreRepoTabsInput): Promise<WorkspaceTabsRestoreResult> {
  input.signal?.throwIfAborted()
  assertCurrentWorkspaceRuntimeMembership(input)
  const initialWorkspace = await getServerWorkspaceState()
  assertCurrentWorkspaceRuntimeMembership(input)
  const entry = workspaceRepoEntry(initialWorkspace, input.repoRoot)
  if (!entry) throw repoNotInWorkspace()
  const repo = await projectWorkspaceRepo(input, entry)
  if (!repo) throw new IpcError({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })

  const projectedTabs = await projectWorkspacePaneTabsWithMembershipGuard({
    restoreInput: input,
    workspaces: [repo],
    confirmMembership: async () => await confirmServerWorkspaceRepoEntry(entry),
    membershipPolicy: 'transaction-authoritative',
    assertCurrent: () => assertCurrentWorkspaceRuntimeMembership(input),
  })
  if (!projectedTabs.matched) throw repoNotInWorkspace()
  return { workspace: repo, snapshot: projectedTabs.snapshots[0]?.snapshot ?? null }
}

async function projectWorkspaceRepo(
  input: RestoreRepoTabsInput,
  entry: WorkspaceSessionEntry,
): Promise<RestoredWorkspaceRuntime | null> {
  if (entry.kind === 'remote') {
    const lifecycle = await abortableWorkspaceRestore(
      runRemoteLifecycleWrite(
        {
          userId: input.userId,
          repoId: entry.id,
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
      name: probe.name ?? workspaceRepoDisplayName(entry.id),
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
    name: probe.name ?? workspaceRepoDisplayName(entry.id),
    workspaceProbe: probe,
    projection,
  }
}

function assertCurrentWorkspaceRuntimeMembership(input: RestoreRepoTabsInput): void {
  if (isCurrentWorkspaceRuntimeMembership(input.userId, input.repoRoot, input.workspaceRuntimeId, input.clientId))
    return
  throw new IpcError({ code: 'BAD_REQUEST', message: 'error.workspace-runtime-stale' })
}

function repoNotInWorkspace(): IpcError {
  return new IpcError({ code: 'NOT_FOUND', message: 'error.workspace-not-in-session' })
}
