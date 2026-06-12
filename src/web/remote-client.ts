import { fetchServerJson, postServerJson } from '#/web/lib/server-fetch.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import type { RemoteDiagnosticsResult, RemotePathSuggestionsInput, SshConfigHostsResult } from '#/shared/remote-repo.ts'

/** Server-side result for resolve-target: concrete target or an i18n
 *  key (e.g. `error.ssh-config-changed`, `repo-tabs.open-remote-home-unavailable`).
 *  Callers localize the error message via `t()`. */
type ResolveTargetResponse = { target: RemoteRepoTarget } | { error: string }

export class SshConfigChangedError extends Error {
  readonly code = 'ssh-config-changed'
  constructor(message = 'error.ssh-config-changed') {
    super(message)
    this.name = 'SshConfigChangedError'
  }
}

export async function resolveRemoteRepositoryTarget(ref: {
  alias: string
  remotePath: string
}): Promise<RemoteRepoTarget> {
  const result = await postServerJson<typeof ref, ResolveTargetResponse>(
    '/api/remote/resolve-target',
    ref,
  )
  if ('error' in result) throw new SshConfigChangedError(result.error)
  return result.target
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

export async function testRemoteRepositoryConnection(
  target: RemoteRepoTarget,
  signal?: AbortSignal,
): Promise<RemoteDiagnosticsResult> {
  return await postServerJson('/api/remote/test-repository', { target }, { signal })
}
