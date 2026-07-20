import { fetchServerJson, postServerJson } from '#/web/lib/server-fetch.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type {
  RemoteDiagnosticsResult,
  RemotePathSuggestionsInput,
  RemoteWorkspaceLifecycleCommandResult,
  RemoteWorkspaceTarget,
  SshConfigHostsResult,
} from '#/shared/remote-workspace.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

/** Server-side result for resolve-target: concrete target or an i18n
 *  key (e.g. `error.ssh-config-changed`, `workspace-picker.open-remote-home-unavailable`).
 *  Callers localize the error message via `t()`. */
type ResolveTargetResponse = { target: RemoteWorkspaceTarget } | { error: string }

export async function resolveRemoteWorkspaceTarget(
  ref: { alias: string; remotePath: string },
  signal?: AbortSignal,
): Promise<RemoteWorkspaceTarget> {
  const result = await postServerJson<typeof ref, ResolveTargetResponse>('/api/remote/resolve-target', ref, { signal })
  if ('error' in result) throw new Error(result.error)
  return result.target
}

/**
 * Submit one command to the server-owned workspace-runtime lifecycle and return
 * its accepted terminal projection.
 */
export async function resolveRemoteWorkspaceConnection(
  input: { workspaceId: WorkspaceId; workspaceRuntimeId: string; mode?: 'restart' | 'ensure' },
  signal?: AbortSignal,
): Promise<RemoteWorkspaceLifecycleCommandResult> {
  return await postServerJson<typeof input, RemoteWorkspaceLifecycleCommandResult>('/api/remote/lifecycle', input, {
    signal,
  })
}

export async function getRemoteSshHosts(): Promise<SshConfigHostsResult> {
  return await fetchServerJson<SshConfigHostsResult>('/api/remote/ssh-hosts')
}

export async function getRemotePathSuggestions(
  input: RemotePathSuggestionsInput,
  signal?: AbortSignal,
): Promise<string[]> {
  return await postServerJson('/api/remote/path-suggestions', input, { signal })
}

export async function testRemoteWorkspaceConnection(
  target: RemoteWorkspaceTarget,
  signal?: AbortSignal,
): Promise<RemoteDiagnosticsResult> {
  return await postServerJson('/api/remote/test-workspace', { target }, { signal })
}
