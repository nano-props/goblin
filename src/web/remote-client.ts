import { fetchServerJson, postServerJson } from '#/web/lib/server-fetch.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import type { RemoteDiagnosticsResult, RemotePathSuggestionsInput, SshConfigHostsResult } from '#/shared/remote-repo.ts'

/**
 * Server-side result for resolve-target: either a concrete target
 * (possibly wrapped in { target }) or a typed error when the alias is
 * missing from the current ~/.ssh/config. Throwing for the error case
 * is intentional — the caller (e.g. the Open Remote dialog) catches
 * and renders the message; the route layer must NOT 500 here.
 */
type ResolveTargetResponse = { target: RemoteRepoTarget } | RemoteRepoTarget | { error: string }

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
  if ('error' in result) {
    throw new SshConfigChangedError(result.error)
  }
  return 'target' in result ? result.target : result
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
