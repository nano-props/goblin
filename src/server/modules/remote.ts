import { runRemoteCommand } from '#/system/ssh/commands.ts'
import { openRemoteInPreferredEditor } from '#/system/editors.ts'
import { openRemoteInPreferredTerminal } from '#/system/terminals.ts'
import { testRemoteRepository } from '#/system/ssh/diagnostics.ts'
import {
  listSshConfigHosts,
  resolveRemoteTarget as resolveSshRemoteTarget,
  resolveTrackedRemoteTarget,
} from '#/system/ssh/config.ts'
import { getServerSettingsPrefs } from '#/server/modules/settings-source.ts'
import {
  isAbsoluteRemotePath,
  isHomeRelativeRemotePath,
  isRemoteRepoId,
  isResolvableRemotePathInput,
  normalizeRemoteTarget,
  parseRemoteRepoId,
  type RemoteConnectionInput,
  type RemoteDiagnosticsResult,
  type RemotePathSuggestionsInput,
  type RemoteRepoTarget,
  type ResolvedRemoteTarget,
  type SshConfigHostsResult,
} from '#/shared/remote-repo.ts'
import type { ExecResult } from '#/shared/git-types.ts'

async function resolveRemoteHomeDirectory(target: RemoteRepoTarget, signal?: AbortSignal): Promise<string> {
  const homeResult = await runRemoteCommand(target, { type: 'printHome' }, { signal })
  const homePath = homeResult.ok ? homeResult.stdout.trim().split(/\r?\n/, 1)[0]?.trim() ?? '' : ''
  if (!homePath.startsWith('/')) throw new Error('repo-tabs.open-remote-home-unavailable')
  return homePath
}

async function expandRemotePathInput(target: RemoteRepoTarget, remotePath: string, signal?: AbortSignal): Promise<string> {
  if (!isHomeRelativeRemotePath(remotePath)) return remotePath.trim()
  const homePath = await resolveRemoteHomeDirectory(target, signal)
  return `${homePath}/${remotePath.trim().slice(2)}`.replace(/\/+/g, '/')
}

export async function getServerSshHosts(): Promise<SshConfigHostsResult> {
  return await listSshConfigHosts()
}

export async function resolveServerRemoteTarget(
  input: RemoteConnectionInput,
  signal?: AbortSignal,
): Promise<ResolvedRemoteTarget> {
  const needsHomeExpansion = input.remotePath.startsWith('~/')
  const resolved = await resolveSshRemoteTarget(needsHomeExpansion ? { ...input, remotePath: '/' } : input, signal)
  if (!needsHomeExpansion) return resolved
  const normalized = normalizeRemoteTarget({
    ...resolved.target,
    remotePath: await expandRemotePathInput(resolved.target, input.remotePath, signal),
  })
  if (!normalized) throw new Error('repo-tabs.open-remote-home-unavailable')
  return { target: normalized }
}

export async function getServerRemotePathSuggestions(
  input: RemotePathSuggestionsInput,
  signal?: AbortSignal,
): Promise<string[]> {
  const prefix = input.prefix.trim()
  if (!isResolvableRemotePathInput(prefix)) return []
  let target: RemoteRepoTarget
  try {
    target = (await resolveSshRemoteTarget({ alias: input.alias, remotePath: '/' }, signal)).target
  } catch {
    return []
  }
  let expandedPrefix: string
  try {
    expandedPrefix = await expandRemotePathInput(target, prefix, signal)
  } catch {
    return []
  }
  const normalizedPrefix = expandedPrefix.replace(/\/+/g, '/')
  const endsWithSlash = normalizedPrefix.endsWith('/')
  const searchRoot = endsWithSlash
    ? normalizedPrefix.replace(/\/+$/, '') || '/'
    : normalizedPrefix.slice(0, Math.max(0, normalizedPrefix.lastIndexOf('/'))) || '/'
  const typedLeaf = endsWithSlash ? '' : normalizedPrefix.slice(normalizedPrefix.lastIndexOf('/') + 1)
  const result = await runRemoteCommand(target, { type: 'listDirectories', path: searchRoot, limit: 20 }, { signal })
  if (!result.ok) return []
  const suggestions = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('/') && (typedLeaf.length === 0 || line.slice(line.lastIndexOf('/') + 1).startsWith(typedLeaf)))
  let output = suggestions
  if (isHomeRelativeRemotePath(prefix)) {
    try {
      const homePath = await resolveRemoteHomeDirectory(target, signal)
      if (homePath !== '/' && normalizedPrefix.startsWith(homePath)) {
        output = suggestions.map((item) => (item === homePath ? '~' : `~${item.slice(homePath.length)}`))
      }
    } catch {}
  }
  return output.slice(0, 20)
}

export async function testServerRemoteRepository(
  target: RemoteRepoTarget,
  signal?: AbortSignal,
): Promise<RemoteDiagnosticsResult> {
  const normalized = normalizeRemoteTarget(target)
  if (!normalized || normalized.id !== target.id) {
    throw new Error('Invalid remote repository target')
  }
  try {
    const resolved = await resolveTrackedRemoteTarget(normalized, signal)
    return await testRemoteRepository(resolved.target, { signal })
  } catch {
    return {
      target: normalized,
      ok: false,
      category: 'config-changed',
      message: 'config-changed',
      stages: [
        { name: 'ssh', label: 'ssh', status: 'failed', category: 'config-changed', message: 'config-changed' },
        { name: 'shell', label: 'shell', status: 'skipped' },
        { name: 'git', label: 'git', status: 'skipped' },
        { name: 'path', label: 'path', status: 'skipped' },
        { name: 'repo', label: 'repo', status: 'skipped' },
      ],
    }
  }
}

export async function openServerRemoteEditor(
  input: { repoId: string; worktreePath: string },
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (!isRemoteRepoId(input.repoId) || !isAbsoluteRemotePath(input.worktreePath)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  const ref = parseRemoteRepoId(input.repoId)
  if (!ref) return { ok: false, message: 'error.invalid-arguments' }

  let resolved: ResolvedRemoteTarget
  try {
    resolved = await resolveSshRemoteTarget(ref, signal)
  } catch {
    return { ok: false, message: 'error.ssh-config-changed' }
  }

  const prefs = await getServerSettingsPrefs()
  return await openRemoteInPreferredEditor(resolved.target.alias, input.worktreePath, prefs.editorApp)
}

export async function openServerRemoteTerminal(
  input: { repoId: string; worktreePath: string },
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (!isRemoteRepoId(input.repoId) || !isAbsoluteRemotePath(input.worktreePath)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  const ref = parseRemoteRepoId(input.repoId)
  if (!ref) return { ok: false, message: 'error.invalid-arguments' }

  let resolved: ResolvedRemoteTarget
  try {
    resolved = await resolveSshRemoteTarget(ref, signal)
  } catch {
    return { ok: false, message: 'error.ssh-config-changed' }
  }

  const prefs = await getServerSettingsPrefs()
  return await openRemoteInPreferredTerminal(resolved.target.alias, input.worktreePath, prefs.terminalApp)
}
