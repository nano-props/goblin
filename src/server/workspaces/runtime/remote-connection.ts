import { runRemoteCommand, SSH_BOOT_PROBE_TIMEOUT_MS } from '#/system/ssh/commands.ts'
import { makeUnresolvedTargetDiagnostic, testRemoteWorkspace } from '#/system/ssh/diagnostics.ts'
import {
  parseRemoteWorkspaceId,
  normalizeRemoteWorkspaceRef,
  REMOTE_DIAGNOSTIC_CATEGORIES,
  toRemoteWorkspaceFailureReason,
  isHomeRelativeRemotePath,
  isRemoteWorkspaceId,
  isResolvableRemotePathInput,
  normalizeRemoteTarget,
  type RemoteConnectionInput,
  type RemoteDiagnosticCategory,
  type RemoteDiagnosticsResult,
  type RemoteWorkspaceConnectionResult,
  type RemoteWorkspaceTarget,
  type ResolvedRemoteWorkspaceTarget,
  type SshConfigHostsResult,
} from '#/shared/remote-workspace.ts'
import type { RemoteDirectoryPathSuggestionsInput } from '#/shared/directory-path-suggestions.ts'
import {
  listSshConfigHosts,
  resolveRemoteTarget as resolveSshRemoteTarget,
  resolveTrackedRemoteTarget,
} from '#/system/ssh/config.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

async function resolveRemoteHomeDirectory(target: RemoteWorkspaceTarget, signal?: AbortSignal): Promise<string> {
  const homeResult = await runRemoteCommand(target, { type: 'printHome' }, { signal })
  const homePath = homeResult.ok ? (homeResult.stdout.trim().split(/\r?\n/, 1)[0]?.trim() ?? '') : ''
  if (!homePath.startsWith('/')) throw new Error('workspace-picker.open-remote-home-unavailable')
  return homePath
}

async function expandRemotePathInput(
  target: RemoteWorkspaceTarget,
  remotePath: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!isHomeRelativeRemotePath(remotePath)) return remotePath.trim()
  const homePath = await resolveRemoteHomeDirectory(target, signal)
  return `${homePath}/${remotePath.trim().slice(2)}`.replace(/\/+/g, '/')
}

export async function getServerSshHosts(): Promise<SshConfigHostsResult> {
  return await listSshConfigHosts()
}

export type ResolveTargetResult =
  | { target: RemoteWorkspaceTarget }
  // Error is an i18n key — callers (route layer / client) translate.
  | { error: string }

export async function resolveServerRemoteTarget(
  input: RemoteConnectionInput,
  signal?: AbortSignal,
): Promise<ResolveTargetResult> {
  const needsHomeExpansion = input.remotePath.startsWith('~/')
  const resolved: ResolvedRemoteWorkspaceTarget | { error: string } = await resolveSshRemoteTarget(
    needsHomeExpansion ? { ...input, remotePath: '/' } : input,
    signal,
  ).catch((error: unknown) => ({
    error: error instanceof Error ? error.message : 'error.failed-read-repo',
  }))
  if ('error' in resolved) return resolved
  if (!needsHomeExpansion) return resolved
  const normalizedResult = await expandRemotePathInput(resolved.target, input.remotePath, signal)
    .then(
      (remotePath) =>
        ({ kind: 'resolved', target: normalizeRemoteTarget({ ...resolved.target, remotePath }) }) as const,
    )
    .catch((error: unknown) => ({
      kind: 'failed' as const,
      error: error instanceof Error ? error.message : 'error.failed-read-repo',
    }))
  if (normalizedResult.kind === 'failed') return { error: normalizedResult.error }
  const normalized = normalizedResult.target
  if (!normalized) return { error: 'workspace-picker.open-remote-home-unavailable' }
  return { target: normalized }
}

/** Resolves and probes one remote workspace, returning only a terminal result. */
export interface RemoteWorkspaceConnectionDeps {
  resolveTarget: (
    input: { alias: string; remotePath: string },
    signal?: AbortSignal,
  ) => Promise<{ target: RemoteWorkspaceTarget } | { error: string }>
  probeRemote: (
    target: RemoteWorkspaceTarget,
    options: { signal?: AbortSignal; timeoutMs: number },
  ) => Promise<{
    ok: boolean
    category?: string
    message?: string
    gitAtWorkspaceRoot?: boolean
    stages?: Array<{ name: string; status: string; category?: string }>
  }>
}

function defaultRemoteWorkspaceConnectionDeps(): RemoteWorkspaceConnectionDeps {
  return {
    resolveTarget: resolveServerRemoteTarget,
    probeRemote: testRemoteWorkspace,
  }
}

export async function resolveServerRemoteWorkspaceConnection(
  input: { workspaceId: WorkspaceId },
  signal?: AbortSignal,
  deps: RemoteWorkspaceConnectionDeps = defaultRemoteWorkspaceConnectionDeps(),
): Promise<RemoteWorkspaceConnectionResult> {
  const workspaceId = input.workspaceId
  if (!isRemoteWorkspaceId(workspaceId)) {
    throw new TypeError('remote workspace connection requires an SSH workspace id')
  }

  const parsed = parseRemoteWorkspaceId(workspaceId)
  const ref = parsed ? normalizeRemoteWorkspaceRef(parsed) : null
  if (!ref) throw new TypeError('canonical SSH workspace ID did not produce a remote workspace reference')
  const targetResult = await deps.resolveTarget({ alias: ref.alias, remotePath: ref.remotePath }, signal)
  if ('error' in targetResult) {
    return {
      kind: 'failed',
      lifecycle: {
        kind: 'failed',
        reason: toRemoteWorkspaceFailureReason(targetResult.error),
      },
    }
  }
  const target = targetResult.target

  const probe = await deps.probeRemote(target, {
    signal,
    timeoutMs: SSH_BOOT_PROBE_TIMEOUT_MS,
  })
  if (!probe.ok) {
    const pathStage = probe.stages?.find((stage) => stage.name === 'path')
    if (pathStage?.status === 'failed') {
      return {
        kind: 'failed',
        lifecycle: {
          kind: 'failed',
          reason: toRemoteWorkspaceFailureReason(pathStage.category ?? 'path-missing'),
          target,
        },
      }
    }
    const probeReason = probe.category ?? probe.message ?? 'unknown'
    const gitUnavailable =
      probeReason === 'not-a-repo' || probeReason === 'git-missing' || probeReason === 'error.workspace-git-unavailable'
    const reason = toRemoteWorkspaceFailureReason(probeReason)
    const directoryReadable = probe.stages?.some((stage) => stage.name === 'path' && stage.status === 'passed')
    if (gitUnavailable || directoryReadable) {
      return {
        kind: 'ready',
        gitAvailable: false,
        ...(probeReason === 'git-missing'
          ? { gitDiagnostic: probe.message ?? 'git-missing' }
          : probeReason === 'not-a-repo'
            ? {}
            : { gitDiagnostic: probe.message ?? probe.category ?? 'Git probe failed' }),
        lifecycle: { kind: 'ready', target },
      }
    }
    return {
      kind: 'failed',
      lifecycle: { kind: 'failed', reason, target },
    }
  }

  if (probe.gitAtWorkspaceRoot === false) {
    return {
      kind: 'ready',
      gitAvailable: false,
      lifecycle: { kind: 'ready', target },
    }
  }

  return {
    kind: 'ready',
    gitAvailable: true,
    lifecycle: { kind: 'ready', target },
  }
}

export async function getServerRemotePathSuggestions(
  input: RemoteDirectoryPathSuggestionsInput,
  signal?: AbortSignal,
): Promise<string[]> {
  const prefix = input.prefix.trim()
  if (!isResolvableRemotePathInput(prefix)) return []
  const target = await resolveSshRemoteTarget({ alias: input.alias, remotePath: '/' }, signal).then(
    (resolved) => resolved.target,
    () => null,
  )
  if (!target) return []
  const expandedPrefix = await expandRemotePathInput(target, prefix, signal).catch(() => null)
  if (!expandedPrefix) return []
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
    .filter(
      (line) =>
        line.startsWith('/') && (typedLeaf.length === 0 || line.slice(line.lastIndexOf('/') + 1).startsWith(typedLeaf)),
    )
  const homePath = isHomeRelativeRemotePath(prefix)
    ? await resolveRemoteHomeDirectory(target, signal).catch(() => null)
    : null
  const output =
    homePath && homePath !== '/' && normalizedPrefix.startsWith(homePath)
      ? suggestions.map((item) => (item === homePath ? '~' : `~${item.slice(homePath.length)}`))
      : suggestions
  return output.slice(0, 20)
}

export async function testServerRemoteWorkspace(
  target: RemoteWorkspaceTarget,
  signal?: AbortSignal,
): Promise<RemoteDiagnosticsResult> {
  const normalized = normalizeRemoteTarget(target)
  if (!normalized || normalized.id !== target.id) {
    throw new Error('Invalid remote workspace target')
  }
  try {
    const resolved = await resolveTrackedRemoteTarget(normalized, signal)
    return await testRemoteWorkspace(resolved.target, { signal })
  } catch (err) {
    // Translation key — client formats via i18n. resolveTrackedRemoteTarget
    // raises either an i18n key (e.g. error.ssh-config-changed) or a real
    // diagnostic category. Anything else falls back to 'unknown'.
    const message = err instanceof Error ? err.message : 'error.ssh-config-changed'
    return makeUnresolvedTargetDiagnostic(normalized, classifyResolutionFailure(message), message)
  }
}

function classifyResolutionFailure(message: string): RemoteDiagnosticCategory {
  if (isRemoteDiagnosticCategory(message)) return message
  if (message === 'error.ssh-config-changed') return 'config-changed'
  return 'unknown'
}

function isRemoteDiagnosticCategory(value: string): value is RemoteDiagnosticCategory {
  return (REMOTE_DIAGNOSTIC_CATEGORIES as readonly string[]).includes(value)
}
