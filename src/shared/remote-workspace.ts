import {
  canonicalWorkspaceLocator,
  formatWorkspaceLocator,
  parseWorkspaceLocator,
  type WorkspaceId,
} from '#/shared/workspace-locator.ts'
import { isStringIn } from '#/shared/string-literals.ts'

export interface RemoteWorkspaceRef {
  id: WorkspaceId
  alias: string
  remotePath: string
  displayName: string
}

export interface RemoteWorkspaceTarget extends RemoteWorkspaceRef {
  host: string
  user: string
  port: number
  /** Server-captured effective SSH configuration; omitted on client-originated targets. */
  sshConnection?: {
    readonly destination: string
    readonly options: readonly string[]
  }
}

export type WorkspaceSessionEntry = { id: WorkspaceId }

export function sameWorkspaceSessionEntry(
  a: WorkspaceSessionEntry | null | undefined,
  b: WorkspaceSessionEntry | null | undefined,
): boolean {
  return !!a && !!b && a.id === b.id
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

export interface ResolvedRemoteWorkspaceTarget {
  target: RemoteWorkspaceTarget
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
  target: RemoteWorkspaceTarget
  ok: boolean
  stages: RemoteDiagnosticStage[]
  category?: RemoteDiagnosticCategory
  message?: string
  details?: string
  /** True only when the physical selected directory and physical Git top-level are identical. */
  gitAtWorkspaceRoot?: boolean
}

/**
 * Lifecycle-level failure reason for a remote workspace.
 *
 * This is intentionally coarser than {@link RemoteDiagnosticCategory}:
 * the diagnostic category explains *why* a probe step failed (with
 * sub-categories like `shell-failed`, `git-missing`, `cancelled`),
 * while this reason classifies the *outcome* of a lifecycle run at
 * the level the UI cares about. `cancelled` and transient sub-step
 * failures map to `unknown` here — the lifecycle command caller decides
 * whether to retry.
 */
export type RemoteWorkspaceFailureReason =
  | 'config-changed'
  | 'auth-failed'
  | 'host-key'
  | 'unreachable'
  | 'handshake-failed'
  | 'path-missing'
  | 'timeout'
  | 'unknown'

export const REMOTE_WORKSPACE_FAILURE_REASONS: readonly RemoteWorkspaceFailureReason[] = [
  'config-changed',
  'auth-failed',
  'host-key',
  'unreachable',
  'handshake-failed',
  'path-missing',
  'timeout',
  'unknown',
]

export function isRemoteWorkspaceFailureReason(value: unknown): value is RemoteWorkspaceFailureReason {
  return isStringIn(REMOTE_WORKSPACE_FAILURE_REASONS, value)
}

/**
 * Map a raw failure source (i18n key, `RemoteDiagnosticCategory`, or
 * arbitrary string) to a {@link RemoteWorkspaceFailureReason}. Shared
 * between the server lifecycle boundary and web-side failure writes.
 * The lifecycle union takes a `RemoteWorkspaceFailureReason` directly, and this
 * helper keeps the `RemoteDiagnosticCategory` / i18n-key mapping in one
 * definition.
 */
export function toRemoteWorkspaceFailureReason(reason: string): RemoteWorkspaceFailureReason {
  if (isRemoteWorkspaceFailureReason(reason)) return reason
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
    case 'timeout':
      return 'timeout'
    default:
      return 'unknown'
  }
}

/**
 * The single source-of-truth lifecycle state for a remote workspace.
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
export type RemoteWorkspaceConnectionLifecycle =
  | { kind: 'connecting' }
  | { kind: 'ready'; target: RemoteWorkspaceTarget }
  | { kind: 'failed'; reason: RemoteWorkspaceFailureReason; target?: RemoteWorkspaceTarget }

/** Authoritative lifecycle owned by one server workspace-runtime generation. */
export type RemoteWorkspaceRuntimeLifecycle =
  | { kind: 'idle'; attemptId: number }
  | { kind: 'connecting'; attemptId: number }
  | { kind: 'ready'; attemptId: number; target: RemoteWorkspaceTarget }
  | { kind: 'failed'; attemptId: number; reason: RemoteWorkspaceFailureReason; target?: RemoteWorkspaceTarget }

export type RemoteWorkspaceLifecycleCommandResult =
  | {
      kind: 'settled'
      workspaceId: WorkspaceId
      name: string
      lifecycle: Extract<RemoteWorkspaceRuntimeLifecycle, { kind: 'ready' | 'failed' }>
    }
  | { kind: 'superseded'; workspaceId: WorkspaceId }
  | { kind: 'stale-runtime'; workspaceId: WorkspaceId }

/** Narrow a lifecycle to its concrete target, if any. */
export function remoteWorkspaceConnectionTarget(
  lifecycle: RemoteWorkspaceConnectionLifecycle | null | undefined,
): RemoteWorkspaceTarget | null {
  if (!lifecycle) return null
  if (lifecycle.kind === 'ready') return lifecycle.target
  if (lifecycle.kind === 'failed') return lifecycle.target ?? null
  return null
}

/** Whether the lifecycle is in the transient `connecting` state. */
export function isRemoteWorkspaceConnectionConnecting(
  lifecycle: RemoteWorkspaceConnectionLifecycle | null | undefined,
): boolean {
  return !!lifecycle && lifecycle.kind === 'connecting'
}

/** Whether the lifecycle has converged to a terminal state. */
export function isRemoteWorkspaceConnectionTerminal(
  lifecycle: RemoteWorkspaceConnectionLifecycle | null | undefined,
): lifecycle is
  | { kind: 'ready'; target: RemoteWorkspaceTarget }
  | { kind: 'failed'; reason: RemoteWorkspaceFailureReason; target?: RemoteWorkspaceTarget } {
  return !!lifecycle && (lifecycle.kind === 'ready' || lifecycle.kind === 'failed')
}

/**
 * Server-side converged result for a remote-workspace lifecycle run.
 *
 * This is the terminal output of the server resolver. WorkspaceRuntime owns the
 * surrounding `connecting -> ready|failed` lifecycle and attempt generation.
 *
 * `lifecycle.target` is the same `RemoteWorkspaceTarget` the
 * runtime publishes in its canonical lifecycle. The `target?` in the failed
 * variant retains the last-known target so the UI keeps
 * showing the remote locator on a failed workspace.
 */
export type RemoteWorkspaceConnectionResult =
  | {
      kind: 'ready'
      name: string
      gitAvailable: boolean
      gitDiagnostic?: string
      lifecycle: { kind: 'ready'; target: RemoteWorkspaceTarget }
    }
  | {
      kind: 'failed'
      name: string
      lifecycle: { kind: 'failed'; reason: RemoteWorkspaceFailureReason; target?: RemoteWorkspaceTarget }
    }

export interface RemoteWorkspaceTargetInput {
  alias?: unknown
  host?: unknown
  user?: unknown
  port?: unknown
  remotePath?: unknown
  displayName?: unknown
}

export interface RemoteWorkspaceRefInput {
  alias?: unknown
  remotePath?: unknown
  displayName?: unknown
}

export function normalizeRemoteWorkspaceId(input: RemoteWorkspaceRefInput): WorkspaceId {
  const normalized = remoteRefFields(input)
  if (!normalized) throw new TypeError('Invalid remote workspace reference')
  const locator = formatWorkspaceLocator(
    { transport: 'ssh', profile: normalized.alias, path: normalized.remotePath },
    'posix',
  )
  if (!locator) throw new TypeError('Invalid remote workspace reference')
  return locator
}

export function isRemoteWorkspaceId(value: string): value is WorkspaceId {
  return parseWorkspaceLocator(value, 'posix')?.transport === 'ssh'
}

export function normalizeRemoteWorkspaceRef(input: unknown): RemoteWorkspaceRef | null {
  const fields = remoteRefFields(input)
  if (!fields) return null
  const id = normalizeRemoteWorkspaceId(fields)
  return {
    id,
    alias: fields.alias,
    remotePath: fields.remotePath,
    displayName: remoteDisplayName(fields),
  }
}

export function normalizeRemoteTarget(input: unknown): RemoteWorkspaceTarget | null {
  const ref = normalizeRemoteWorkspaceRef(input)
  const fields = remoteTargetFields(input)
  if (!ref || !fields) return null
  return {
    ...ref,
    host: fields.host,
    user: fields.user,
    port: fields.port,
  }
}

export function remoteDisplayName(target: Pick<RemoteWorkspaceTargetInput, 'alias' | 'host' | 'remotePath'>): string {
  const alias = typeof target.alias === 'string' && safeText(target.alias) ? target.alias.trim() : null
  const host = typeof target.host === 'string' && safeText(target.host) ? target.host.trim() : 'remote'
  const remotePath =
    typeof target.remotePath === 'string' && safeText(target.remotePath) ? normalizeRemotePath(target.remotePath) : null
  return `${alias ?? host}:${basename(remotePath ?? '/')}`
}

export function isRemoteWorkspaceTarget(value: unknown): value is RemoteWorkspaceTarget {
  if (!value || typeof value !== 'object') return false
  const normalized = normalizeRemoteTarget(value)
  return (
    !!normalized &&
    normalized.id === Reflect.get(value, 'id') &&
    normalized.displayName === Reflect.get(value, 'displayName')
  )
}

export function workspaceSessionEntryId(entry: WorkspaceSessionEntry): WorkspaceId {
  return entry.id
}

export function localWorkspaceSessionEntry(id: WorkspaceId): WorkspaceSessionEntry {
  return { id }
}

export function remoteWorkspaceSessionEntry(ref: RemoteWorkspaceRef | RemoteWorkspaceTarget): WorkspaceSessionEntry {
  const normalized = normalizeRemoteWorkspaceRef(ref)
  if (!normalized) throw new TypeError('Invalid remote workspace reference')
  return { id: normalized.id }
}

export function normalizeWorkspaceSessionEntry(input: unknown): WorkspaceSessionEntry | null {
  if (!input || typeof input !== 'object' || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'id')) return null
  const rawId = Reflect.get(input, 'id')
  if (typeof rawId !== 'string') return null
  const id = canonicalWorkspaceLocator(rawId)
  return id ? { id } : null
}

export function parseRemoteWorkspaceId(workspaceId: string): Pick<RemoteWorkspaceRef, 'alias' | 'remotePath'> | null {
  const parsed = parseWorkspaceLocator(workspaceId, 'posix')
  return parsed?.transport === 'ssh' ? { alias: parsed.profile, remotePath: parsed.path } : null
}

export function remoteWorkspaceRefFromTarget(target: RemoteWorkspaceTarget): RemoteWorkspaceRef {
  const ref = normalizeRemoteWorkspaceRef(target)
  if (!ref) throw new TypeError('Invalid remote workspace target')
  return ref
}

function remoteTargetFields(input: unknown): Pick<RemoteWorkspaceTarget, 'host' | 'user' | 'port'> | null {
  if (!input || typeof input !== 'object') return null
  const rawHost = Reflect.get(input, 'host')
  const rawUser = Reflect.get(input, 'user')
  const host = typeof rawHost === 'string' ? rawHost.trim() : ''
  const user = typeof rawUser === 'string' ? rawUser.trim() : ''
  const port = normalizePort(Reflect.get(input, 'port'))
  if (!safeText(host) || !safeText(user) || port === null) return null
  return { host, user, port }
}

function remoteRefFields(input: unknown): Pick<RemoteWorkspaceRef, 'alias' | 'remotePath'> | null {
  if (!input || typeof input !== 'object') return null
  const rawAlias = Reflect.get(input, 'alias')
  const rawRemotePath = Reflect.get(input, 'remotePath')
  const alias = typeof rawAlias === 'string' ? rawAlias : ''
  const remotePath = typeof rawRemotePath === 'string' ? rawRemotePath : ''
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
