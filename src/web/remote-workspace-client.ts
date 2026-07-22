import { fetchServerJson, postServerJson } from '#/web/lib/server-fetch.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type {
  RemoteDiagnosticsResult,
  RemoteWorkspaceLifecycleCommandResult,
  RemoteWorkspaceTarget,
  SshConfigHostsResult,
} from '#/shared/remote-workspace.ts'
import type { RemoteDirectoryPathSuggestionsInput } from '#/shared/directory-path-suggestions.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { decodeWith } from '#/shared/http-response-schema.ts'
import {
  RemoteDiagnosticsResponseSchema,
  RemoteLifecycleResponseSchema,
  ResolveRemoteTargetResponseSchema,
  SshConfigHostsResponseSchema,
  StringArrayResponseSchema,
} from '#/shared/workspace-http-response-schema.ts'

/** Server-side result for resolve-target: concrete target or an i18n
 *  key (e.g. `error.ssh-config-changed`, `workspace-picker.open-remote-home-unavailable`).
 *  Callers localize the error message via `t()`. */
type ResolveTargetResponse = { target: RemoteWorkspaceTarget } | { error: string }

export async function resolveRemoteWorkspaceTarget(
  ref: { alias: string; remotePath: string },
  signal?: AbortSignal,
): Promise<RemoteWorkspaceTarget> {
  const result = await postServerJson('/api/remote/resolve-target', ref, decodeWith(ResolveRemoteTargetResponseSchema), { signal })
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
  return await postServerJson('/api/remote/lifecycle', input, decodeWith(RemoteLifecycleResponseSchema), {
    signal,
  })
}

export async function getRemoteSshHosts(): Promise<SshConfigHostsResult> {
  return await fetchServerJson('/api/remote/ssh-hosts', decodeWith(SshConfigHostsResponseSchema))
}

export async function getRemotePathSuggestions(
  input: RemoteDirectoryPathSuggestionsInput,
  signal?: AbortSignal,
): Promise<string[]> {
  return await postServerJson('/api/remote/path-suggestions', input, decodeWith(StringArrayResponseSchema), { signal })
}

export async function testRemoteWorkspaceConnection(
  target: RemoteWorkspaceTarget,
  signal?: AbortSignal,
): Promise<RemoteDiagnosticsResult> {
  return await postServerJson('/api/remote/test-workspace', { target }, decodeWith(RemoteDiagnosticsResponseSchema), { signal })
}
