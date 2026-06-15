import { fetchServerJson, postServerJson } from '#/web/lib/server-fetch.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type {
  RemoteDiagnosticsResult,
  RemotePathSuggestionsInput,
  RemoteRepoLifecycleResult,
  RemoteRepoTarget,
  SshConfigHostsResult,
} from '#/shared/remote-repo.ts'

/** Server-side result for resolve-target: concrete target or an i18n
 *  key (e.g. `error.ssh-config-changed`, `repo-tabs.open-remote-home-unavailable`).
 *  Callers localize the error message via `t()`. */
type ResolveTargetResponse = { target: RemoteRepoTarget } | { error: string }

export async function resolveRemoteRepositoryTarget(
  ref: { alias: string; remotePath: string },
  signal?: AbortSignal,
): Promise<RemoteRepoTarget> {
  const result = await postServerJson<typeof ref, ResolveTargetResponse>(
    '/api/remote/resolve-target',
    ref,
    { signal },
  )
  if ('error' in result) throw new Error(result.error)
  return result.target
}

/**
 * Single-server-call remote-repo lifecycle boundary (see
 * docs/.../plan §5). The server composes resolveTarget +
 * probe + classification and returns a converged
 * `RemoteRepoLifecycleResult` (ready or failed, never
 * connecting). The orchestrator's task is a thin
 * delegation to this function.
 */
export async function resolveRemoteRepoLifecycle(
  input: { repoId: string },
  signal?: AbortSignal,
): Promise<RemoteRepoLifecycleResult> {
  return await postServerJson<typeof input, RemoteRepoLifecycleResult>(
    '/api/remote/lifecycle',
    input,
    { signal },
  )
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

export async function openRemoteRepositoryEditor(repoId: string, worktreePath: string): Promise<ExecResult> {
  return await postServerJson('/api/remote/open-editor', { repoId, worktreePath })
}

export async function openRemoteRepositoryTerminal(repoId: string, worktreePath: string): Promise<ExecResult> {
  return await postServerJson('/api/remote/open-terminal', { repoId, worktreePath })
}
