import { publishUserRepoQueryInvalidation } from '#/server/modules/invalidation-broker.ts'
import { resolveServerRemoteRepoConnection } from '#/server/modules/remote.ts'
import {
  commitOrReadInitialWorkspaceProbeState,
  runRepoRemoteLifecycle,
  runSerializedWorkspaceRefresh,
  workspaceProbeStateForRuntime,
} from '#/server/modules/repo-runtimes.ts'
import type { RemoteRepoLifecycleCommandResult } from '#/shared/remote-repo.ts'
import type { WorkspaceProbeState, WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'

export interface RunRemoteLifecycleInput {
  userId: string
  repoId: string
  repoRuntimeId: string
  mode: 'restart' | 'ensure'
}

export interface RunRemoteLifecycleOptions {
  beforeCapabilityCommit?: (input: { before: WorkspaceProbeState; after: WorkspaceSettledProbeState }) => Promise<void>
}

export async function runRemoteLifecycleWrite(
  input: RunRemoteLifecycleInput,
  options: RunRemoteLifecycleOptions = {},
): Promise<RemoteRepoLifecycleCommandResult> {
  const { userId, repoId, repoRuntimeId, mode } = input
  const observed: { gitCapability: { available: boolean; diagnostic?: string } | null } = { gitCapability: null }
  const result = await runRepoRemoteLifecycle(
    userId,
    repoId,
    repoRuntimeId,
    async (signal) => {
      const resolved = await resolveServerRemoteRepoConnection({ repoId }, signal)
      if (resolved.kind === 'ready') {
        observed.gitCapability = {
          available: resolved.gitAvailable,
          ...(resolved.gitDiagnostic ? { diagnostic: resolved.gitDiagnostic } : {}),
        }
      }
      return resolved
    },
    () => publishUserRepoQueryInvalidation(userId, { repoId, query: 'remote-lifecycle' }),
    mode,
  )
  if (result.kind !== 'settled') return { kind: result.kind, repoId }
  if (result.lifecycle.kind === 'failed') {
    const current = workspaceProbeStateForRuntime(userId, repoId, repoRuntimeId)
    if (current?.status === 'probing') {
      commitOrReadInitialWorkspaceProbeState({
        userId,
        repoRoot: repoId,
        repoRuntimeId,
        probe: {
          status: 'unavailable',
          reason:
            result.lifecycle.reason === 'path-missing'
              ? 'error.workspace-path-not-found'
              : 'error.workspace-transport-unavailable',
        },
      })
    }
  }
  const gitCapability = observed.gitCapability
  if (result.lifecycle.kind === 'ready' && gitCapability) {
    const probe: WorkspaceSettledProbeState = {
      status: 'ready',
      name: result.name,
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: gitCapability.available
          ? { status: 'available', worktrees: true, pullRequests: { provider: 'none' } }
          : { status: 'unavailable' },
      },
      diagnostics: gitCapability.diagnostic ? [{ scope: 'git', message: gitCapability.diagnostic }] : [],
    }
    const current = workspaceProbeStateForRuntime(userId, repoId, repoRuntimeId)
    if (current?.status === 'probing') {
      commitOrReadInitialWorkspaceProbeState({ userId, repoRoot: repoId, repoRuntimeId, probe })
    } else {
      await runSerializedWorkspaceRefresh({
        userId,
        repoRoot: repoId,
        repoRuntimeId,
        probe: async () => probe,
        beforeCommit: async (transition) => {
          if (gitBecameUnavailable(transition.before, transition.after) && !options.beforeCapabilityCommit) {
            throw new Error('workspace capability downgrade requires transactional cleanup')
          }
          await options.beforeCapabilityCommit?.(transition)
        },
      })
    }
  }
  return { kind: 'settled', repoId, name: result.name, lifecycle: result.lifecycle }
}

function gitBecameUnavailable(before: WorkspaceProbeState, after: WorkspaceSettledProbeState): boolean {
  return (
    before.status === 'ready' &&
    before.capabilities.git.status === 'available' &&
    after.status === 'ready' &&
    after.capabilities.git.status === 'unavailable'
  )
}
