import { publishUserWorkspaceRuntimeInvalidation } from '#/server/modules/invalidation-broker.ts'
import { resolveServerRemoteWorkspaceConnection } from '#/server/modules/remote-workspace.ts'
import { runRemoteWorkspaceLifecycle, workspaceProbeStateForRuntime } from '#/server/modules/workspace-runtimes.ts'
import { isRemoteWorkspaceId, type RemoteWorkspaceLifecycleCommandResult } from '#/shared/remote-workspace.ts'
import type { WorkspaceProbeState, WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'
import { workspaceGitCleanupRequired } from '#/server/modules/workspace-capability-transition.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface RunRemoteWorkspaceLifecycleInput {
  userId: string
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  mode: 'restart' | 'ensure'
}

export interface RunRemoteWorkspaceLifecycleOptions {
  beforeCapabilityCommit?: (input: { before: WorkspaceProbeState; after: WorkspaceSettledProbeState }) => Promise<void>
}

export async function runRemoteWorkspaceLifecycleWrite(
  input: RunRemoteWorkspaceLifecycleInput,
  options: RunRemoteWorkspaceLifecycleOptions = {},
): Promise<RemoteWorkspaceLifecycleCommandResult> {
  const { userId, workspaceId, workspaceRuntimeId, mode } = input
  if (!isRemoteWorkspaceId(workspaceId)) {
    throw new TypeError('remote workspace lifecycle requires an SSH workspace id')
  }
  const result = await runRemoteWorkspaceLifecycle(
    userId,
    workspaceId,
    workspaceRuntimeId,
    async (signal) => await resolveServerRemoteWorkspaceConnection({ workspaceId }, signal),
    () => publishUserWorkspaceRuntimeInvalidation(userId, { workspaceId }),
    mode,
    (resolved) => {
      if (resolved.kind === 'failed') {
        return {
          workspaceProbe: {
            mode: 'initial-only',
            probe: {
              status: 'unavailable',
              reason:
                resolved.lifecycle.reason === 'path-missing'
                  ? 'error.workspace-path-not-found'
                  : 'error.workspace-transport-unavailable',
            },
          },
        }
      }
      const probe: WorkspaceSettledProbeState = {
        status: 'ready',
        name: resolved.name,
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: resolved.gitAvailable
            ? { status: 'available', worktrees: true, pullRequests: { provider: 'none' } }
            : { status: 'unavailable' },
        },
        diagnostics: resolved.gitDiagnostic ? [{ scope: 'git', message: resolved.gitDiagnostic }] : [],
      }
      return {
        workspaceProbe: {
          mode: 'refresh',
          probe,
          beforeCommit: async (transition) => {
            if (workspaceGitCleanupRequired(transition.before, transition.after) && !options.beforeCapabilityCommit) {
              throw new Error('workspace capability downgrade requires transactional cleanup')
            }
            await options.beforeCapabilityCommit?.(transition)
          },
        },
      }
    },
  )
  if (result.kind !== 'settled') return { kind: result.kind, workspaceId }
  if (!workspaceProbeStateForRuntime(userId, workspaceId, workspaceRuntimeId))
    return { kind: 'stale-runtime', workspaceId }
  return { kind: 'settled', workspaceId, name: result.name, lifecycle: result.lifecycle }
}
