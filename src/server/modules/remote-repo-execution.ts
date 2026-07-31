import {
  remoteWorkspaceRuntimeFailureFromCommandResult,
  remoteWorkspaceRuntimeFailureFromTargetResolutionError,
} from '#/server/modules/remote-workspace-runtime-failure.ts'
import { parseRemoteWorkspaceId, type RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { runRemoteCommand } from '#/system/ssh/commands.ts'
import { resolveRemoteTarget as resolveSshRemoteTarget } from '#/system/ssh/config.ts'
import type { RemoteGitRunner } from '#/system/ssh/git.ts'

export interface RepoSourceRuntimeContext {
  workspaceRuntimeId: string
}

export async function resolveRemoteWorkspaceTarget(
  repoId: string,
  runtime?: RepoSourceRuntimeContext,
  signal?: AbortSignal,
): Promise<RemoteWorkspaceTarget> {
  try {
    const parsed = parseRemoteWorkspaceId(repoId)
    if (!parsed) throw new Error('error.ssh-config-changed')
    return (await resolveSshRemoteTarget(parsed, signal)).target
  } catch (err) {
    if (!runtime) throw err
    throw remoteWorkspaceRuntimeFailureFromTargetResolutionError({
      workspaceId: repoId,
      workspaceRuntimeId: runtime.workspaceRuntimeId,
      error: err,
    })
  }
}

export function remoteRuntimeAwareGitRunner(
  repoRoot: string,
  workspaceRuntimeId: string,
  sourceTarget: RemoteWorkspaceTarget,
): RemoteGitRunner {
  return async (command, target, options) => {
    const result = await runRemoteCommand(target, command, options)
    const failure = remoteWorkspaceRuntimeFailureFromCommandResult({
      workspaceId: repoRoot,
      workspaceRuntimeId,
      target: sourceTarget,
      result,
    })
    if (failure) throw failure
    return result
  }
}
