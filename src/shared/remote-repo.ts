export type RepoKind = 'local' | 'remote'

export interface RemoteRepoTarget {
  id: string
  alias: string | null
  host: string
  user: string
  port: number
  remotePath: string
  identityFile?: string
  displayName: string
}

export type LocalRepoSessionEntry = { kind: 'local'; id: string }
export type RemoteRepoSessionEntry = { kind: 'remote'; id: string; target: RemoteRepoTarget }
export type RepoSessionEntry = LocalRepoSessionEntry | RemoteRepoSessionEntry

export interface SshConfigHost {
  alias: string
  hostName?: string
  user?: string
  port?: number
}

export type RemoteConnectionInput =
  | { mode: 'config'; alias: string; remotePath: string; identityFile?: string }
  | { mode: 'manual'; host: string; user: string; port?: number; remotePath: string; identityFile?: string }

export interface SshInitConnectionInput {
  host: string
  user: string
  port: number
}

export type SshInitKeyStatus = 'existing' | 'generated' | 'public-key-recreated'
export type SshInitHostKeyStatus = 'trusted' | 'needs-confirmation' | 'changed'

export interface SshHostKeyConfirmation {
  host: string
  port: number
  key: string
  keyType: string
  fingerprint: string
}

export type SshInitPrepareResult =
  | { ok: true; keyStatus: SshInitKeyStatus; hostKeyStatus: 'trusted' }
  | {
      ok: true
      keyStatus: SshInitKeyStatus
      hostKeyStatus: 'needs-confirmation'
      confirmation: SshHostKeyConfirmation
    }
  | {
      ok: true
      keyStatus: SshInitKeyStatus
      hostKeyStatus: 'changed'
      confirmation: SshHostKeyConfirmation
    }
  | { ok: false; keyStatus?: SshInitKeyStatus; message: string }

export interface SshInitTrustHostKeyInput {
  host: string
  port: number
  key: string
  fingerprint: string
}

export interface SshInitAccessInput extends SshInitConnectionInput {
  password: string
}

export interface ResolvedRemoteTarget {
  target: RemoteRepoTarget
}

export type RemoteDiagnosticStageName = 'ssh' | 'shell' | 'git' | 'path' | 'repo'
export type RemoteDiagnosticStageStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
export type RemoteDiagnosticCategory =
  | 'auth failed'
  | 'host key'
  | 'unreachable'
  | 'shell failed'
  | 'git missing'
  | 'path missing'
  | 'not a repo'
  | 'timeout'
  | 'cancelled'
  | 'config changed'
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
  identityFile?: unknown
  displayName?: unknown
}

export function normalizeRemoteRepoId(input: RemoteRepoTargetInput): string {
  const normalized = remoteTargetFields(input)
  if (!normalized) throw new TypeError('Invalid remote repository target')
  return `ssh://${encodeURIComponent(normalized.user)}@${normalized.host}:${normalized.port}${encodeRemotePath(
    normalized.remotePath,
  )}`
}

export function normalizeRemoteTarget(input: RemoteRepoTargetInput): RemoteRepoTarget | null {
  const fields = remoteTargetFields(input)
  if (!fields) return null
  const id = normalizeRemoteRepoId(fields)
  const displayName =
    typeof input.displayName === 'string' && safeText(input.displayName)
      ? input.displayName.trim()
      : remoteDisplayName(fields)
  return {
    id,
    alias: fields.alias,
    host: fields.host,
    user: fields.user,
    port: fields.port,
    remotePath: fields.remotePath,
    ...(fields.identityFile ? { identityFile: fields.identityFile } : {}),
    displayName,
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

export function parseRemoteRepoId(repoId: string): Omit<RemoteRepoTarget, 'id' | 'displayName' | 'alias'> | null {
  if (!repoId.startsWith('ssh://')) return null
  const rest = repoId.slice('ssh://'.length)
  const pathIdx = rest.indexOf('/')
  if (pathIdx === -1) return null
  const authority = rest.slice(0, pathIdx)
  const remotePath = decodeURIComponent(rest.slice(pathIdx).replace(/\+/g, '%20'))
  const atIdx = authority.lastIndexOf('@')
  if (atIdx === -1) return null
  const user = decodeURIComponent(authority.slice(0, atIdx))
  const hostPort = authority.slice(atIdx + 1)
  const colonIdx = hostPort.lastIndexOf(':')
  const host = colonIdx === -1 ? hostPort : hostPort.slice(0, colonIdx)
  const port = colonIdx === -1 ? 22 : Number(hostPort.slice(colonIdx + 1))
  if (!host || !user || !Number.isFinite(port) || !Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host, user, port, remotePath }
}

function remoteTargetFields(input: RemoteRepoTargetInput): Omit<RemoteRepoTarget, 'id' | 'displayName'> | null {
  const host = typeof input.host === 'string' ? input.host.trim() : ''
  const user = typeof input.user === 'string' ? input.user.trim() : ''
  const alias = typeof input.alias === 'string' && safeText(input.alias) ? input.alias.trim() : null
  const remotePath = typeof input.remotePath === 'string' ? normalizeRemotePath(input.remotePath) : null
  const port = normalizePort(input.port)
  const identityFile = normalizeIdentityFile(input.identityFile)
  if (!safeText(host) || !safeText(user) || !remotePath || port === null) return null
  return { alias, host, user, port, remotePath, ...(identityFile ? { identityFile } : {}) }
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

function normalizeIdentityFile(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return safeText(trimmed) ? trimmed : undefined
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
