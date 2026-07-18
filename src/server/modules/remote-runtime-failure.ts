import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import type { RemoteRepoFailureReason, RemoteRepoTarget } from '#/shared/remote-repo.ts'

export class RemoteRepoRuntimeFailureError extends Error {
  readonly repoRoot: string
  readonly workspaceRuntimeId: string
  readonly reason: RemoteRepoFailureReason
  readonly target?: RemoteRepoTarget

  constructor(input: {
    repoRoot: string
    workspaceRuntimeId: string
    reason: RemoteRepoFailureReason
    target?: RemoteRepoTarget
    message?: string
  }) {
    super(input.message ?? input.reason)
    this.name = 'RemoteRepoRuntimeFailureError'
    this.repoRoot = input.repoRoot
    this.workspaceRuntimeId = input.workspaceRuntimeId
    this.reason = input.reason
    if (input.target) this.target = input.target
  }
}

export function isRemoteRepoRuntimeFailure(error: unknown): error is RemoteRepoRuntimeFailureError {
  return error instanceof RemoteRepoRuntimeFailureError
}

export function remoteRuntimeFailureReasonFromCommandResult(
  result: RemoteCommandResult,
  target?: RemoteRepoTarget,
): RemoteRepoFailureReason | null {
  if (result.ok || result.message === 'cancelled') return null
  // Before the remote-start marker, stderr is the local OpenSSH client's
  // startup stream. After the marker, only trust stderr that the runner
  // separated into transportStderr; raw command stderr may contain upstream
  // Git/SSH failures from inside the remote shell.
  if (result.remoteStarted) return remoteRuntimeTransportFailureAfterStart(result, target)
  if (result.timedOut || result.message === 'timeout') return 'timeout'
  const text = `${result.stderr}\n${result.stdout}\n${result.message ?? ''}`.toLowerCase()
  if (text.includes('host key verification failed') || text.includes('remote host identification has changed')) {
    return 'host-key'
  }
  if (
    text.includes('permission denied') ||
    text.includes('authentication failed') ||
    text.includes('too many authentication failures')
  ) {
    return 'auth-failed'
  }
  if (
    text.includes('kex_exchange_identification') ||
    text.includes('ssh_exchange_identification') ||
    text.includes('banner exchange') ||
    text.includes('connection reset by peer') ||
    text.includes('connection closed by remote host') ||
    /connection closed by .* port \d+/u.test(text)
  ) {
    return 'handshake-failed'
  }
  if (
    text.includes('could not resolve hostname') ||
    text.includes('name or service not known') ||
    text.includes('connection timed out') ||
    text.includes('operation timed out') ||
    text.includes('connection refused') ||
    text.includes('no route to host')
  ) {
    return 'unreachable'
  }
  return null
}

function remoteRuntimeTransportFailureAfterStart(
  result: RemoteCommandResult,
  target?: RemoteRepoTarget,
): RemoteRepoFailureReason | null {
  // Post-start command stderr is ambiguous unless the SSH runner separated it
  // from the local client's diagnostics. Only classify the separated transport
  // stream; remote command stderr may include upstream Git/SSH failures.
  if (result.transportStderr === undefined) return null
  const text = result.transportStderr.toLowerCase()
  if (textMentionsOpenSshClientLoopTransportFailure(text)) return 'unreachable'
  if (target && textMentionsTargetTransportFailure(text, target)) {
    return 'unreachable'
  }
  return null
}

function textMentionsOpenSshClientLoopTransportFailure(text: string): boolean {
  const prefix = 'client_loop: send disconnect:'
  for (const line of transportTailLines(text)) {
    if (line.startsWith(prefix) && isTargetPortTransportFailure(line.slice(prefix.length))) return true
  }
  return false
}

function textMentionsTargetTransportFailure(text: string, target: RemoteRepoTarget): boolean {
  const destination = (target.sshConnection?.destination ?? target.alias).trim().toLowerCase()
  if (!destination) return false
  const prefix = `connection to ${destination}`
  const port = String(target.port)
  const portPrefix = `${prefix} port ${port}: `
  for (const line of transportTailLines(text)) {
    if (line.startsWith(prefix) && /^ closed\b/u.test(line.slice(prefix.length))) return true
    if (lineStartsWithCompleteToken(line, `connection closed by ${destination} port ${port}`)) return true
    if (lineStartsWithCompleteToken(line, `connection reset by ${destination} port ${port}`)) return true
    if (line.startsWith(portPrefix) && isTargetPortTransportFailure(line.slice(portPrefix.length))) {
      return true
    }
  }
  return false
}

function transportTailLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-2)
}

function lineStartsWithCompleteToken(line: string, prefix: string): boolean {
  if (!line.startsWith(prefix)) return false
  const next = line.at(prefix.length)
  return next === undefined || next === '.' || next === ':' || /\s/u.test(next)
}

function isTargetPortTransportFailure(text: string): boolean {
  return (
    text.includes('connection reset') ||
    text.includes('connection closed') ||
    text.includes('connection timed out') ||
    text.includes('operation timed out') ||
    text.includes('broken pipe') ||
    text.includes('connection refused') ||
    text.includes('no route to host')
  )
}

export function remoteRuntimeFailureFromCommandResult(input: {
  repoRoot: string
  workspaceRuntimeId: string
  target?: RemoteRepoTarget
  result: RemoteCommandResult
}): RemoteRepoRuntimeFailureError | null {
  const reason = remoteRuntimeFailureReasonFromCommandResult(input.result, input.target)
  if (!reason) return null
  return new RemoteRepoRuntimeFailureError({
    repoRoot: input.repoRoot,
    workspaceRuntimeId: input.workspaceRuntimeId,
    reason,
    target: input.target,
    message: input.result.message,
  })
}

export function remoteRuntimeFailureFromTargetResolutionError(input: {
  repoRoot: string
  workspaceRuntimeId: string
  error: unknown
}): RemoteRepoRuntimeFailureError {
  const message = input.error instanceof Error ? input.error.message : String(input.error)
  const text = message.toLowerCase()
  const timedOut =
    typeof input.error === 'object' &&
    input.error !== null &&
    'timedOut' in input.error &&
    (input.error as { timedOut?: unknown }).timedOut === true
  const reason: RemoteRepoFailureReason = timedOut || text.includes('timed out') ? 'timeout' : 'config-changed'
  return new RemoteRepoRuntimeFailureError({
    repoRoot: input.repoRoot,
    workspaceRuntimeId: input.workspaceRuntimeId,
    reason,
    message,
  })
}
