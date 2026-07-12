import { fetchServerJson, postServerJson } from '#/web/lib/server-fetch.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type { EditorApp, TerminalApp } from '#/shared/api-types.ts'
import type {
  RemoteDiagnosticsResult,
  RemotePathSuggestionsInput,
  RemoteRepoLifecycleCommandResult,
  RemoteRepoTarget,
  SshConfigHostsResult,
} from '#/shared/remote-repo.ts'

/** Server-side result for resolve-target: concrete target or an i18n
 *  key (e.g. `error.ssh-config-changed`, `repo-picker.open-remote-home-unavailable`).
 *  Callers localize the error message via `t()`. */
type ResolveTargetResponse = { target: RemoteRepoTarget } | { error: string }

export async function resolveRemoteRepositoryTarget(
  ref: { alias: string; remotePath: string },
  signal?: AbortSignal,
): Promise<RemoteRepoTarget> {
  const result = await postServerJson<typeof ref, ResolveTargetResponse>('/api/remote/resolve-target', ref, { signal })
  if ('error' in result) throw new Error(result.error)
  return result.target
}

/**
 * Submit one command to the server-owned repo-runtime lifecycle and return
 * its accepted terminal projection.
 */
export async function resolveRemoteRepoConnection(
  input: { repoId: string; repoRuntimeId: string; mode?: 'restart' | 'ensure' },
  signal?: AbortSignal,
): Promise<RemoteRepoLifecycleCommandResult> {
  return await postServerJson<typeof input, RemoteRepoLifecycleCommandResult>('/api/remote/lifecycle', input, { signal })
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

export async function testRemoteRepoConnection(
  target: RemoteRepoTarget,
  signal?: AbortSignal,
): Promise<RemoteDiagnosticsResult> {
  return await postServerJson('/api/remote/test-repo', { target }, { signal })
}

export async function openRemoteRepositoryEditor(
  repoId: string,
  worktreePath: string,
  app: EditorApp,
): Promise<ExecResult> {
  return await postServerJson('/api/remote/open-editor', { repoId, worktreePath, app })
}

export async function openRemoteRepositoryTerminal(
  repoId: string,
  worktreePath: string,
  app: TerminalApp,
): Promise<ExecResult> {
  return await postServerJson('/api/remote/open-terminal', { repoId, worktreePath, app })
}
