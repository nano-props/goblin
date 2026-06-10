import { fetchServerJson, postServerJson } from '#/web/lib/server-fetch.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import type {
  RemoteDiagnosticsResult,
  RemotePathSuggestionsInput,
  SshConfigHostsResult,
} from '#/shared/remote-repo.ts'
import type { ExecResult } from '#/shared/git-types.ts'

export async function resolveRemoteRepositoryTarget(ref: {
  alias: string
  remotePath: string
}): Promise<RemoteRepoTarget> {
  const result = await postServerJson<typeof ref, RemoteRepoTarget | { target: RemoteRepoTarget }>(
    '/api/remote/resolve-target',
    ref,
  )
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

export async function openRemoteRepositoryEditor(repoId: string, worktreePath: string): Promise<ExecResult> {
  return await postServerJson('/api/remote/open-editor', { repoId, worktreePath })
}

export async function openRemoteRepositoryTerminal(repoId: string, worktreePath: string): Promise<ExecResult> {
  return await postServerJson('/api/remote/open-terminal', { repoId, worktreePath })
}
