import type { RestoredWorkspaceRuntime, WorkspaceTabsRestoreResult } from '#/shared/api-types.ts'
import { CodedError } from '#/shared/coded-error.ts'
import { isRemoteWorkspaceId, type WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import { readRepoSnapshot } from '#/server/modules/repo-read-paths.ts'
import {
  captureWorkspaceRuntimeMembershipCapability,
  runSerializedInitialWorkspaceProbe,
  WorkspaceRuntimeStaleError,
  workspaceProbeStateForRuntime,
  type WorkspaceRuntimeMembershipCapability,
} from '#/server/modules/workspace-runtimes.ts'
import { runRemoteWorkspaceLifecycleWrite } from '#/server/modules/remote-workspace-lifecycle-write-paths.ts'
import { confirmServerWorkspaceEntry, getServerWorkspaceState } from '#/server/modules/settings-source.ts'
import { restoreWorkspacePaneTabsForMemberships, workspaceEntry } from '#/server/modules/workspace-pane-tabs-restore.ts'
import { abortableWorkspaceRestore } from '#/server/modules/workspace-restore-utils.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import { probeWorkspace } from '#/server/modules/workspace-probe.ts'
import {
  commitGitCapabilityRemovalOrThrow,
  type WorkspaceCapabilityTransitionHost,
} from '#/server/workspace-capability-transition-host.ts'
import { workspaceGitCleanupRequired } from '#/server/modules/workspace-capability-transition.ts'
import {
  workspaceGitAvailable,
  type WorkspaceProbeState,
  type WorkspaceSettledProbeState,
} from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface RestoreWorkspaceTabsInput {
  userId: string
  clientId: string
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost
  signal?: AbortSignal
}

export async function restoreWorkspaceTabs(input: RestoreWorkspaceTabsInput): Promise<WorkspaceTabsRestoreResult> {
  try {
    return await restoreWorkspaceTabsForCurrentMembership(input)
  } catch (error) {
    if (error instanceof WorkspaceRuntimeStaleError) {
      throw new CodedError({ code: 'BAD_REQUEST', message: error.message })
    }
    throw error
  }
}

async function restoreWorkspaceTabsForCurrentMembership(
  input: RestoreWorkspaceTabsInput,
): Promise<WorkspaceTabsRestoreResult> {
  input.signal?.throwIfAborted()
  const runtimeCapability = captureWorkspaceRuntimeMembershipCapability(
    input.userId,
    input.workspaceId,
    input.workspaceRuntimeId,
    input.clientId,
  )
  const initialWorkspace = await getServerWorkspaceState()
  runtimeCapability.assertCurrent()
  const entry = workspaceEntry(initialWorkspace, input.workspaceId)
  if (!entry) throw workspaceNotInSession()
  const workspace = await projectWorkspace(input, entry, runtimeCapability)
  if (!workspace) throw new CodedError({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })

  const projectedTabs = await restoreWorkspacePaneTabsForMemberships({
    restoreInput: input,
    workspaces: [{ ...workspace, runtimeCapability }],
    confirmMembership: async () => await confirmServerWorkspaceEntry(entry),
    membershipPolicy: 'transaction-authoritative',
  })
  if (!projectedTabs.matched) throw workspaceNotInSession()
  runtimeCapability.assertCurrent()
  return { workspace, snapshot: projectedTabs.snapshots[0]?.snapshot ?? null }
}

async function projectWorkspace(
  input: RestoreWorkspaceTabsInput,
  entry: WorkspaceSessionEntry,
  runtimeCapability: WorkspaceRuntimeMembershipCapability,
): Promise<RestoredWorkspaceRuntime | null> {
  if (isRemoteWorkspaceId(entry.id)) {
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
              runtimeCapability,
            })
          },
        },
      ),
      input.signal,
    )
    runtimeCapability.assertCurrent()
    if (lifecycle.kind !== 'settled') return null
    const workspaceProbe = lifecycle.workspaceProbe
    if (lifecycle.lifecycle.kind === 'failed') {
      return {
        entry,
        workspaceId: entry.id,
        workspaceRuntimeId: input.workspaceRuntimeId,
        transport: { kind: 'ssh', lifecycle: lifecycle.lifecycle },
        workspaceProbe,
        repoSnapshot: null,
      }
    }
    if (!workspaceGitAvailable(workspaceProbe)) {
      return {
        entry,
        workspaceId: entry.id,
        workspaceRuntimeId: input.workspaceRuntimeId,
        transport: { kind: 'ssh', lifecycle: lifecycle.lifecycle },
        workspaceProbe,
        repoSnapshot: null,
      }
    }
    const { snapshot } = await readRepoSnapshot(entry.id, {
      workspaceRuntimeId: input.workspaceRuntimeId,
      signal: input.signal,
    })
    runtimeCapability.assertCurrent()
    return {
      entry,
      workspaceId: entry.id,
      workspaceRuntimeId: input.workspaceRuntimeId,
      transport: { kind: 'ssh', lifecycle: lifecycle.lifecycle },
      workspaceProbe,
      repoSnapshot: snapshot,
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
          runtimeCapability,
        })
      },
    })
    probe = authoritativeProbe
  }
  runtimeCapability.assertCurrent()
  if (probe.status !== 'ready') return null
  if (!workspaceGitAvailable(probe)) {
    return {
      entry,
      workspaceId: entry.id,
      workspaceRuntimeId: input.workspaceRuntimeId,
      transport: { kind: 'file' },
      workspaceProbe: probe,
      repoSnapshot: null,
    }
  }
  const { snapshot } = await readRepoSnapshot(entry.id, {
    workspaceRuntimeId: input.workspaceRuntimeId,
    signal: input.signal,
  })
  runtimeCapability.assertCurrent()
  return {
    entry,
    workspaceId: entry.id,
    workspaceRuntimeId: input.workspaceRuntimeId,
    transport: { kind: 'file' },
    workspaceProbe: probe,
    repoSnapshot: snapshot,
  }
}

function workspaceNotInSession(): CodedError {
  return new CodedError({ code: 'NOT_FOUND', message: 'error.workspace-not-in-session' })
}
