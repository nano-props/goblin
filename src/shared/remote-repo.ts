export type RepoKind = 'local' | 'remote'

import { formatWorkspaceLocator, parseWorkspaceLocator } from '#/shared/workspace-locator.ts'

export interface RemoteRepoRef {
  id: string
  alias: string
  remotePath: string
  displayName: string
}

export interface RemoteRepoTarget extends RemoteRepoRef {
  host: string
  user: string
  port: number
  /** Server-captured effective SSH configuration; omitted on client-originated targets. */
  sshConnection?: {
    readonly destination: string
    readonly options: readonly string[]
  }
}

export type LocalRepoSessionEntry = { kind: 'local'; id: string }
export type RemoteRepoSessionEntry = { kind: 'remote'; id: string; ref: RemoteRepoRef }
export type RepoSessionEntry = LocalRepoSessionEntry | RemoteRepoSessionEntry

export function sameRepoSessionEntry(
  a: RepoSessionEntry | null | undefined,
  b: RepoSessionEntry | null | undefined,
): boolean {
  if (!a || !b || a.kind !== b.kind || a.id !== b.id) return false
  if (a.kind === 'local' || b.kind === 'local') return true
  return (
    a.ref.id === b.ref.id &&
    a.ref.alias === b.ref.alias &&
    a.ref.remotePath === b.ref.remotePath &&
    a.ref.displayName === b.ref.displayName
  )
}

export interface SshConfigHost {
  alias: string
  hostName?: string
  user?: string
  port?: number
}

export interface SshConfigHostsResult {
  hosts: SshConfigHost[]
  hasInclude: boolean
}

export type RemoteConnectionInput = { alias: string; remotePath: string }

export interface RemotePathSuggestionsInput extends RemoteConnectionInput {
  prefix: string
}

export interface ResolvedRemoteTarget {
  target: RemoteRepoTarget
}

export type RemoteDiagnosticStageName = 'ssh' | 'shell' | 'git' | 'path' | 'repo'
export type RemoteDiagnosticStageStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
export type RemoteDiagnosticCategory =
  | 'auth-failed'
  | 'host-key'
  | 'unreachable'
  | 'handshake-failed'
  | 'shell-failed'
  | 'git-missing'
  | 'path-missing'
  | 'not-a-repo'
  | 'timeout'
  | 'cancelled'
  | 'config-changed'
  | 'unknown'

/** Runtime mirror of {@link RemoteDiagnosticCategory}. Use this to
 *  check whether an arbitrary string is a known category before
 *  casting — e.g. when reconstructing diagnostics from an
 *  upstream-passed error message. */
export const REMOTE_DIAGNOSTIC_CATEGORIES: readonly RemoteDiagnosticCategory[] = [
  'auth-failed',
  'host-key',
  'unreachable',
  'handshake-failed',
  'shell-failed',
  'git-missing',
  'path-missing',
  'not-a-repo',
  'timeout',
  'cancelled',
  'config-changed',
  'unknown',
]

export interface RemoteDiagnosticStage {
  name: RemoteDiagnosticStageName
  label: string
  status: RemoteDiagnosticStageStatus
  category?: RemoteDiagnosticCategory
  message?: string
  details?: string
}

export interface RemoteDiagnosticsResult {
  target: RemoteRepoTarget
  ok: boolean
  stages: RemoteDiagnosticStage[]
  category?: RemoteDiagnosticCategory
  message?: string
  details?: string
}

/**
 * Lifecycle-level failure reason for a remote repo.
 *
 * This is intentionally coarser than {@link RemoteDiagnosticCategory}:
 * the diagnostic category explains *why* a probe step failed (with
 * sub-categories like `shell-failed`, `git-missing`, `cancelled`),
 * while this reason classifies the *outcome* of a lifecycle run at
 * the level the UI cares about. `cancelled` and transient sub-step
 * failures map to `unknown` here — the lifecycle command caller decides
 * whether to retry.
 */
export type RemoteRepoFailureReason =
  | 'config-changed'
  | 'auth-failed'
  | 'host-key'
  | 'unreachable'
  | 'handshake-failed'
  | 'path-missing'
  | 'not-a-repo'
  | 'timeout'
  | 'unknown'

export const REMOTE_REPO_FAILURE_REASONS: readonly RemoteRepoFailureReason[] = [
  'config-changed',
  'auth-failed',
  'host-key',
  'unreachable',
  'handshake-failed',
  'path-missing',
  'not-a-repo',
  'timeout',
  'unknown',
]

export function isRemoteRepoFailureReason(value: unknown): value is RemoteRepoFailureReason {
  return typeof value === 'string' && (REMOTE_REPO_FAILURE_REASONS as readonly string[]).includes(value)
}

/**
 * Map a raw failure source (i18n key, `RemoteDiagnosticCategory`, or
 * arbitrary string) to a {@link RemoteRepoFailureReason}. Shared
 * between the server lifecycle boundary and web-side failure writes.
 * The lifecycle union takes a `RemoteRepoFailureReason` directly, and this
 * helper keeps the `RemoteDiagnosticCategory` / i18n-key mapping in one
 * definition.
 */
export function toRemoteRepoFailureReason(reason: string): RemoteRepoFailureReason {
  if (isRemoteRepoFailureReason(reason)) return reason
  switch (reason) {
    case 'error.ssh-config-changed':
    case 'config-changed':
      return 'config-changed'
    case 'auth-failed':
      return 'auth-failed'
    case 'host-key':
      return 'host-key'
    case 'unreachable':
      return 'unreachable'
    case 'handshake-failed':
    case 'shell-failed':
      return 'handshake-failed'
    case 'path-missing':
    case 'error.path-not-found':
    case 'error.path-not-directory':
      return 'path-missing'
    case 'not-a-repo':
    case 'git-missing':
    case 'error.not-git-repo':
      return 'not-a-repo'
    case 'timeout':
      return 'timeout'
    default:
      return 'unknown'
  }
}

/**
 * The single source-of-truth lifecycle state for a remote repo.
 *
 * Three orthogonal meanings collapse into one union:
 *   - `connecting`: lifecycle started, has not yet converged
 *   - `ready`:      lifecycle converged to success; concrete target is known
 *   - `failed`:     lifecycle converged to failure; last-known target may be
 *                   retained so the UI can still display remote context
 *
 * `target` is intentionally only accessible inside the union so callers
 * cannot infer connectivity from unrelated remote fields.
 */
export type RemoteRepoConnectionLifecycle =
  | { kind: 'connecting' }
  | { kind: 'ready'; target: RemoteRepoTarget }
  | { kind: 'failed'; reason: RemoteRepoFailureReason; target?: RemoteRepoTarget }

/** Authoritative lifecycle owned by one server repo-runtime generation. */
export type RemoteRepoRuntimeLifecycle =
  | { kind: 'idle'; attemptId: number }
  | { kind: 'connecting'; attemptId: number }
  | { kind: 'ready'; attemptId: number; target: RemoteRepoTarget }
  | { kind: 'failed'; attemptId: number; reason: RemoteRepoFailureReason; target?: RemoteRepoTarget }

export type RemoteRepoLifecycleCommandResult =
  | {
      kind: 'settled'
      repoId: string
      name: string
      lifecycle: Extract<RemoteRepoRuntimeLifecycle, { kind: 'ready' | 'failed' }>
    }
  | { kind: 'superseded'; repoId: string }
  | { kind: 'stale-runtime'; repoId: string }

/** Narrow a lifecycle to its concrete target, if any. */
export function remoteRepoConnectionTarget(
  lifecycle: RemoteRepoConnectionLifecycle | null | undefined,
): RemoteRepoTarget | null {
  if (!lifecycle) return null
  if (lifecycle.kind === 'ready') return lifecycle.target
  if (lifecycle.kind === 'failed') return lifecycle.target ?? null
  return null
}

/** Whether the lifecycle is in the transient `connecting` state. */
export function isRemoteRepoConnectionConnecting(lifecycle: RemoteRepoConnectionLifecycle | null | undefined): boolean {
  return !!lifecycle && lifecycle.kind === 'connecting'
}

/** Whether the lifecycle has converged to a terminal state. */
export function isRemoteRepoConnectionTerminal(
  lifecycle: RemoteRepoConnectionLifecycle | null | undefined,
): lifecycle is
  | { kind: 'ready'; target: RemoteRepoTarget }
  | { kind: 'failed'; reason: RemoteRepoFailureReason; target?: RemoteRepoTarget } {
  return !!lifecycle && (lifecycle.kind === 'ready' || lifecycle.kind === 'failed')
}

/**
 * Server-side converged result for a remote-repo lifecycle run.
 *
 * This is the terminal output of the server resolver. RepoRuntime owns the
 * surrounding `connecting -> ready|failed` lifecycle and attempt generation.
 *
 * `lifecycle.target` is the same `RemoteRepoTarget` the
 * runtime publishes in its canonical lifecycle. The `target?` in the failed
 * variant retains the last-known target so the UI keeps
 * showing the remote locator on a failed repository.
 */
export type RemoteRepoConnectionResult =
  | {
      kind: 'ready'
      repoId: string
      name: string
      gitAvailable: boolean
      gitDiagnostic?: string
      lifecycle: { kind: 'ready'; target: RemoteRepoTarget }
    }
  | {
      kind: 'failed'
      repoId: string
      name: string
      lifecycle: { kind: 'failed'; reason: RemoteRepoFailureReason; target?: RemoteRepoTarget }
    }

export interface RemoteRepoTargetInput {
  alias?: unknown
  host?: unknown
  user?: unknown
  port?: unknown
  remotePath?: unknown
  displayName?: unknown
}

export interface RemoteRepoRefInput {
  alias?: unknown
  remotePath?: unknown
  displayName?: unknown
}

export function normalizeRemoteRepoId(input: RemoteRepoRefInput): string {
  const normalized = remoteRefFields(input)
  if (!normalized) throw new TypeError('Invalid remote repository reference')
  const locator = formatWorkspaceLocator(
    { transport: 'ssh', profile: normalized.alias, path: normalized.remotePath },
    'posix',
  )
  if (!locator) throw new TypeError('Invalid remote repository reference')
  return locator
}

export function isRemoteRepoId(value: string): boolean {
  return parseWorkspaceLocator(value, 'posix')?.transport === 'ssh'
}

export function normalizeRemoteRepoRef(input: RemoteRepoRefInput): RemoteRepoRef | null {
  const fields = remoteRefFields(input)
  if (!fields) return null
  const id = normalizeRemoteRepoId(fields)
  return {
    id,
    alias: fields.alias,
    remotePath: fields.remotePath,
    displayName: remoteDisplayName(fields),
  }
}

export function normalizeRemoteTarget(input: RemoteRepoTargetInput): RemoteRepoTarget | null {
  const ref = normalizeRemoteRepoRef(input)
  const fields = remoteTargetFields(input)
  if (!ref || !fields) return null
  return {
    ...ref,
    host: fields.host,
    user: fields.user,
    port: fields.port,
  }
}

export function remoteDisplayName(target: Pick<RemoteRepoTargetInput, 'alias' | 'host' | 'remotePath'>): string {
  const alias = typeof target.alias === 'string' && safeText(target.alias) ? target.alias.trim() : null
  const host = typeof target.host === 'string' && safeText(target.host) ? target.host.trim() : 'remote'
  const remotePath =
    typeof target.remotePath === 'string' && safeText(target.remotePath) ? normalizeRemotePath(target.remotePath) : null
  return `${alias ?? host}:${basename(remotePath ?? '/')}`
}

export function isRemoteRepoTarget(value: unknown): value is RemoteRepoTarget {
  if (!value || typeof value !== 'object') return false
  const target = value as RemoteRepoTarget
  const normalized = normalizeRemoteTarget(target)
  return !!normalized && normalized.id === target.id && normalized.displayName === target.displayName
}

export function repoSessionEntryId(entry: RepoSessionEntry): string {
  return entry.id
}

export function localRepoSessionEntry(id: string): LocalRepoSessionEntry {
  return { kind: 'local', id }
}

export function remoteRepoSessionEntry(ref: RemoteRepoRef | RemoteRepoTarget): RemoteRepoSessionEntry {
  const normalized = normalizeRemoteRepoRef(ref)
  if (!normalized) throw new TypeError('Invalid remote repository reference')
  return { kind: 'remote', id: normalized.id, ref: normalized }
}

export function normalizeRepoSessionEntry(input: unknown): RepoSessionEntry | null {
  if (!input || typeof input !== 'object') return null
  const entry = input as Partial<RepoSessionEntry> & { ref?: unknown }
  if (entry.kind === 'local') {
    if (typeof entry.id !== 'string') return null
    const parsed = parseWorkspaceLocator(entry.id, 'posix') ?? parseWorkspaceLocator(entry.id, 'win32')
    return parsed?.transport === 'file' ? { kind: 'local', id: entry.id } : null
  }
  if (entry.kind === 'remote') {
    if (typeof entry.id !== 'string') return null
    const ref = normalizeRemoteRepoRef(entry.ref as RemoteRepoRefInput)
    if (!ref || entry.id !== ref.id) return null
    return { kind: 'remote', id: ref.id, ref }
  }
  return null
}

export function parseRemoteRepoId(repoId: string): Pick<RemoteRepoRef, 'alias' | 'remotePath'> | null {
  const parsed = parseWorkspaceLocator(repoId, 'posix')
  return parsed?.transport === 'ssh' ? { alias: parsed.profile, remotePath: parsed.path } : null
}

export function remoteRepoRefFromTarget(target: RemoteRepoTarget): RemoteRepoRef {
  const ref = normalizeRemoteRepoRef(target)
  if (!ref) throw new TypeError('Invalid remote repository target')
  return ref
}

function remoteTargetFields(input: RemoteRepoTargetInput): Pick<RemoteRepoTarget, 'host' | 'user' | 'port'> | null {
  if (!input || typeof input !== 'object') return null
  const host = typeof input.host === 'string' ? input.host.trim() : ''
  const user = typeof input.user === 'string' ? input.user.trim() : ''
  const port = normalizePort(input.port)
  if (!safeText(host) || !safeText(user) || port === null) return null
  return { host, user, port }
}

function remoteRefFields(input: RemoteRepoRefInput): Pick<RemoteRepoRef, 'alias' | 'remotePath'> | null {
  if (!input || typeof input !== 'object') return null
  const alias = typeof input.alias === 'string' ? input.alias : ''
  const remotePath = typeof input.remotePath === 'string' ? input.remotePath : ''
  const locator = formatWorkspaceLocator({ transport: 'ssh', profile: alias, path: remotePath }, 'posix')
  if (!locator) return null
  return { alias, remotePath }
}

function normalizePort(value: unknown): number | null {
  const port = value === undefined || value === null || value === '' ? 22 : value
  if (typeof port !== 'number' || !Number.isFinite(port) || !Number.isInteger(port)) return null
  return port >= 1 && port <= 65535 ? port : null
}

function normalizeRemotePath(value: string): string | null {
  const trimmed = value.trim()
  if (!safeText(trimmed) || !trimmed.startsWith('/')) return null
  const normalized = trimmed.replace(/\/+/g, '/').replace(/\/$/, '')
  return normalized || '/'
}

function safeText(value: string): boolean {
  return value.length > 0 && !value.includes('\0') && !/[\x00-\x1f\x7f]/.test(value)
}

function basename(remotePath: string): string {
  const trimmed = remotePath.replace(/\/+$/, '')
  if (!trimmed || trimmed === '/') return '/'
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed
}

export function isAbsoluteRemotePath(value: string): boolean {
  return value.startsWith('/') && !value.includes('\0')
}

export function isHomeRelativeRemotePath(value: string): boolean {
  return value.startsWith('~/') && !value.includes('\0')
}

export function isResolvableRemotePathInput(value: string): boolean {
  return isAbsoluteRemotePath(value) || isHomeRelativeRemotePath(value)
}
