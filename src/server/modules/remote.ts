import { runRemoteCommand, SSH_BOOT_PROBE_TIMEOUT_MS } from '#/system/ssh/commands.ts'
import { makeUnresolvedTargetDiagnostic, testRemoteRepo } from '#/system/ssh/diagnostics.ts'
import {
  parseRemoteRepoId,
  normalizeRemoteRepoRef,
  REMOTE_DIAGNOSTIC_CATEGORIES,
  toRemoteRepoFailureReason,
  isHomeRelativeRemotePath,
  isRemoteRepoId,
  isResolvableRemotePathInput,
  normalizeRemoteTarget,
  type RemoteConnectionInput,
  type RemoteDiagnosticCategory,
  type RemoteDiagnosticsResult,
  type RemotePathSuggestionsInput,
  type RemoteRepoConnectionResult,
  type RemoteRepoTarget,
  type ResolvedRemoteTarget,
  type SshConfigHostsResult,
} from '#/shared/remote-repo.ts'
import { openRemoteInPreferredEditor } from '#/system/editors.ts'
import { openRemoteInPreferredTerminal } from '#/system/terminals.ts'
import {
  listSshConfigHosts,
  resolveRemoteTarget as resolveSshRemoteTarget,
  resolveTrackedRemoteTarget,
} from '#/system/ssh/config.ts'
import { isSafeRemoteAbsolutePath } from '#/system/remote-shell.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type { EditorApp, TerminalApp } from '#/shared/api-types.ts'

async function resolveRemoteHomeDirectory(target: RemoteRepoTarget, signal?: AbortSignal): Promise<string> {
  const homeResult = await runRemoteCommand(target, { type: 'printHome' }, { signal })
  const homePath = homeResult.ok ? (homeResult.stdout.trim().split(/\r?\n/, 1)[0]?.trim() ?? '') : ''
  if (!homePath.startsWith('/')) throw new Error('repo-picker.open-remote-home-unavailable')
  return homePath
}

async function expandRemotePathInput(
  target: RemoteRepoTarget,
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
  | { target: RemoteRepoTarget }
  // Error is an i18n key — callers (route layer / client) translate.
  | { error: string }

export async function resolveServerRemoteTarget(
  input: RemoteConnectionInput,
  signal?: AbortSignal,
): Promise<ResolveTargetResult> {
  const needsHomeExpansion = input.remotePath.startsWith('~/')
  let resolved: ResolvedRemoteTarget
  try {
    resolved = await resolveSshRemoteTarget(needsHomeExpansion ? { ...input, remotePath: '/' } : input, signal)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'error.failed-read-repo' }
  }
  if (!needsHomeExpansion) return resolved
  let normalized: RemoteRepoTarget | null
  try {
    normalized = normalizeRemoteTarget({
      ...resolved.target,
      remotePath: await expandRemotePathInput(resolved.target, input.remotePath, signal),
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'error.failed-read-repo' }
  }
  if (!normalized) return { error: 'repo-picker.open-remote-home-unavailable' }
  return { target: normalized }
}

/**
 * Server-side unified boundary for the remote-repo lifecycle
 * (docs/goblin-remote-repo-refactor-plan.md §5).
 *
 * Composes, in order:
 *   1. parse the `repoId` into a `RemoteRepoRef` (alias +
 *      remotePath)
 *   2. resolve the SSH target via the existing
 *      `resolveServerRemoteTarget` (parses the SSH config, runs
 *      `ssh -G` to compute the effective config, expands `~/`)
 *   3. probe the remote repo via `testRemoteRepo` (SSH
 *      handshake + `checkShell`/`checkGit`/`revParseTopLevel`)
 *   4. classify the failure into a `RemoteRepoFailureReason`
 *   5. return a converged {@link RemoteRepoConnectionResult}
 *
 * The function NEVER returns a `connecting` lifecycle — that's
 * a client-side projection written by the orchestrator before
 * this RPC lands. The server's contract is "converged terminal
 * only".
 *
 * The signal is plumbed through the entire pipeline:
 *   - `resolveServerRemoteTarget` propagates to the `ssh -G`
 *     execa call (`system/ssh/config.ts:resolveEffectiveConfig`)
 *   - `testRemoteRepo` propagates to each per-stage
 *     `runRemoteCommand` (the SSH handshake / checkShell / etc.
 *     execas in `system/ssh/commands.ts:runRemoteCommand`)
 *
 * Aborting the signal is the only way a `runRemoteRepoConnection`
 * orchestrator run in the client can free the lane's
 * concurrency slot before its natural timeout — see
 * `runLatestOperation` with the `lifecycle` lane.
 */
export async function resolveServerRemoteRepoConnection(
  input: { repoId: string },
  signal?: AbortSignal,
): Promise<RemoteRepoConnectionResult> {
  const repoId = input.repoId
  // Defensive: local ids should never reach this server entry.
  // The orchestrator gates on `isRemoteRepoId` before calling;
  // if a non-remote id sneaks through, return a 'failed' with a
  // synthesized reason rather than letting the SSH resolver throw.
  if (!isRemoteRepoId(repoId)) {
    return {
      kind: 'failed',
      repoId,
      name: repoId,
      lifecycle: { kind: 'failed', reason: 'not-a-repo' },
    }
  }

  // Step 1: parse the id into a ref.
  const parsed = parseRemoteRepoId(repoId)
  const ref = parsed ? normalizeRemoteRepoRef(parsed) : null
  if (!ref) {
    return {
      kind: 'failed',
      repoId,
      name: parsed?.alias ?? repoId,
      lifecycle: { kind: 'failed', reason: 'config-changed' },
    }
  }

  // Step 2: resolve the SSH target.
  const targetResult = await resolveServerRemoteTarget({ alias: ref.alias, remotePath: ref.remotePath }, signal)
  if ('error' in targetResult) {
    return {
      kind: 'failed',
      repoId,
      name: ref.displayName,
      lifecycle: {
        kind: 'failed',
        reason: toRemoteRepoFailureReason(targetResult.error),
      },
    }
  }
  const target = targetResult.target

  // Step 3: probe the remote repo.
  const probe = await testRemoteRepo(target, {
    signal,
    timeoutMs: SSH_BOOT_PROBE_TIMEOUT_MS,
  })
  if (!probe.ok) {
    const reason = toRemoteRepoFailureReason(probe.category ?? probe.message ?? 'unknown')
    return {
      kind: 'failed',
      repoId,
      name: ref.displayName,
      lifecycle: { kind: 'failed', reason, target },
    }
  }

  // Step 4: success.
  return {
    kind: 'ready',
    repoId,
    name: ref.displayName,
    lifecycle: { kind: 'ready', target },
  }
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
    .filter(
      (line) =>
        line.startsWith('/') && (typedLeaf.length === 0 || line.slice(line.lastIndexOf('/') + 1).startsWith(typedLeaf)),
    )
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

export async function testServerRemoteRepo(
  target: RemoteRepoTarget,
  signal?: AbortSignal,
): Promise<RemoteDiagnosticsResult> {
  const normalized = normalizeRemoteTarget(target)
  if (!normalized || normalized.id !== target.id) {
    throw new Error('Invalid remote repository target')
  }
  try {
    const resolved = await resolveTrackedRemoteTarget(normalized, signal)
    return await testRemoteRepo(resolved.target, { signal })
  } catch (err) {
    // Translation key — client formats via i18n. resolveTrackedRemoteTarget
    // raises either an i18n key (e.g. error.ssh-config-changed) or a real
    // diagnostic category. Anything else falls back to 'unknown'.
    const message = err instanceof Error ? err.message : 'error.ssh-config-changed'
    return makeUnresolvedTargetDiagnostic(normalized, classifyResolutionFailure(message), message)
  }
}

/** Open a remote worktree in the user's preferred editor. The repo id is
 *  parsed back into its alias / remotePath parts, then re-resolved so the
 *  SSH config hasn't been edited out from under us. */
export async function openServerRemoteEditor(
  input: { repoId: string; worktreePath: string; app: EditorApp },
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (!isRemoteRepoId(input.repoId) || !isSafeRemoteAbsolutePath(input.worktreePath)) {
    return { ok: false, message: 'error.invalid-path' }
  }
  const ref = parseRemoteRepoId(input.repoId)
  if (!ref) return { ok: false, message: 'error.invalid-arguments' }

  let resolved: ResolvedRemoteTarget
  try {
    resolved = await resolveSshRemoteTarget(ref, signal)
  } catch {
    return { ok: false, message: 'error.ssh-config-changed' }
  }

  return await openRemoteInPreferredEditor(resolved.target.alias, input.worktreePath, input.app)
}

export async function openServerRemoteTerminal(
  input: { repoId: string; worktreePath: string; app: TerminalApp },
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (!isRemoteRepoId(input.repoId) || !isSafeRemoteAbsolutePath(input.worktreePath)) {
    return { ok: false, message: 'error.invalid-path' }
  }
  const ref = parseRemoteRepoId(input.repoId)
  if (!ref) return { ok: false, message: 'error.invalid-arguments' }

  let resolved: ResolvedRemoteTarget
  try {
    resolved = await resolveSshRemoteTarget(ref, signal)
  } catch {
    return { ok: false, message: 'error.ssh-config-changed' }
  }

  return await openRemoteInPreferredTerminal(resolved.target.alias, input.worktreePath, input.app)
}

function classifyResolutionFailure(message: string): RemoteDiagnosticCategory {
  if (isRemoteDiagnosticCategory(message)) return message as RemoteDiagnosticCategory
  if (message === 'error.ssh-config-changed') return 'config-changed'
  return 'unknown'
}

function isRemoteDiagnosticCategory(value: string): boolean {
  return (REMOTE_DIAGNOSTIC_CATEGORIES as readonly string[]).includes(value)
}
