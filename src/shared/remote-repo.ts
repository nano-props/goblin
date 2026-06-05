export type RepoKind = 'local' | 'remote'

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
}

export type LocalRepoSessionEntry = { kind: 'local'; id: string }
export type RemoteRepoSessionEntry = { kind: 'remote'; id: string; ref: RemoteRepoRef }
export type RepoSessionEntry = LocalRepoSessionEntry | RemoteRepoSessionEntry

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

const REMOTE_REPO_ID_PREFIX = 'ssh-config://'

export function normalizeRemoteRepoId(input: RemoteRepoRefInput): string {
  const normalized = remoteRefFields(input)
  if (!normalized) throw new TypeError('Invalid remote repository reference')
  return `${REMOTE_REPO_ID_PREFIX}${encodeURIComponent(normalized.alias)}${encodeRemotePath(normalized.remotePath)}`
}

export function isRemoteRepoId(value: string): boolean {
  return value.startsWith(REMOTE_REPO_ID_PREFIX)
}

export function normalizeRemoteRepoRef(input: RemoteRepoRefInput): RemoteRepoRef | null {
  const fields = remoteRefFields(input)
  if (!fields) return null
  const id = normalizeRemoteRepoId(fields)
  const displayName =
    typeof input.displayName === 'string' && safeText(input.displayName)
      ? input.displayName.trim()
      : remoteDisplayName(fields)
  return {
    id,
    alias: fields.alias,
    remotePath: fields.remotePath,
    displayName,
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

export function remoteTargetSubtitle(target: Pick<RemoteRepoTarget, 'host' | 'user' | 'remotePath'>): string {
  return `${target.user}@${target.host}:${target.remotePath}`
}

export function remoteWorktreePathLabel(target: Pick<RemoteRepoTarget, 'host' | 'user'>, path: string): string {
  return `${target.user}@${target.host}:${path}`
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
  return normalizeRemoteTarget(target)?.id === target.id
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
  const entry = input as Partial<RepoSessionEntry> & { target?: unknown; ref?: unknown }
  if (entry.kind === 'local') {
    return typeof entry.id === 'string' && safeText(entry.id) ? { kind: 'local', id: entry.id } : null
  }
  if (entry.kind === 'remote') {
    if (typeof entry.id !== 'string') return null
    const ref = normalizeRemoteRepoRef((entry.ref ?? entry.target) as RemoteRepoRefInput)
    if (!ref) return null
    return { kind: 'remote', id: ref.id, ref }
  }
  return null
}

export function parseRemoteRepoId(repoId: string): Pick<RemoteRepoRef, 'alias' | 'remotePath'> | null {
  if (!isRemoteRepoId(repoId)) return null
  const rest = repoId.slice(REMOTE_REPO_ID_PREFIX.length)
  const pathIdx = rest.indexOf('/')
  if (pathIdx === -1) return null
  const alias = decodeURIComponent(rest.slice(0, pathIdx))
  const remotePath = decodeURIComponent(rest.slice(pathIdx).replace(/\+/g, '%20'))
  if (!alias || !safeText(alias) || !normalizeRemotePath(remotePath)) return null
  return { alias, remotePath }
}

export function remoteRepoRefFromTarget(target: RemoteRepoTarget): RemoteRepoRef {
  return {
    id: target.id,
    alias: target.alias,
    remotePath: target.remotePath,
    displayName: target.displayName,
  }
}

function remoteTargetFields(input: RemoteRepoTargetInput): Pick<RemoteRepoTarget, 'host' | 'user' | 'port'> | null {
  const host = typeof input.host === 'string' ? input.host.trim() : ''
  const user = typeof input.user === 'string' ? input.user.trim() : ''
  const port = normalizePort(input.port)
  if (!safeText(host) || !safeText(user) || port === null) return null
  return { host, user, port }
}

function remoteRefFields(input: RemoteRepoRefInput): Pick<RemoteRepoRef, 'alias' | 'remotePath'> | null {
  const alias = typeof input.alias === 'string' ? input.alias.trim() : ''
  const remotePath = typeof input.remotePath === 'string' ? normalizeRemotePath(input.remotePath) : null
  if (!safeText(alias) || !remotePath) return null
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

function encodeRemotePath(remotePath: string): string {
  return remotePath
    .split('/')
    .map((segment, index) => (index === 0 ? '' : encodeURIComponent(segment)))
    .join('/')
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
