import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import type { RemoteRepoFailureReason, RemoteRepoTarget } from '#/shared/remote-repo.ts'

export class RemoteRepoRuntimeFailureError extends Error {
  readonly repoRoot: string
  readonly repoRuntimeId: string
  readonly reason: RemoteRepoFailureReason
  readonly target?: RemoteRepoTarget

  constructor(input: {
    repoRoot: string
    repoRuntimeId: string
    reason: RemoteRepoFailureReason
    target?: RemoteRepoTarget
    message?: string
  }) {
    super(input.message ?? input.reason)
    this.name = 'RemoteRepoRuntimeFailureError'
    this.repoRoot = input.repoRoot
    this.repoRuntimeId = input.repoRuntimeId
    this.reason = input.reason
    if (input.target) this.target = input.target
  }
}

export function isRemoteRepoRuntimeFailure(error: unknown): error is RemoteRepoRuntimeFailureError {
  return error instanceof RemoteRepoRuntimeFailureError
}

export function remoteRuntimeFailureReasonFromCommandResult(
  result: RemoteCommandResult,
): RemoteRepoFailureReason | null {
  if (result.ok || result.message === 'cancelled') return null
  if (result.timedOut || result.message === 'timeout') return 'timeout'
  const text = `${result.stderr}\n${result.stdout}\n${result.message ?? ''}`.toLowerCase()
  if (text.includes('host key verification failed') || text.includes('remote host identification has changed')) {
    return 'host-key'
  }
  if (text.includes('permission denied') || text.includes('authentication failed')) return 'auth-failed'
  if (
    text.includes('kex_exchange_identification') ||
    text.includes('ssh_exchange_identification') ||
    text.includes('banner exchange') ||
    text.includes('connection reset by peer') ||
    text.includes('connection closed by remote host')
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

export function remoteRuntimeFailureFromCommandResult(input: {
  repoRoot: string
  repoRuntimeId: string
  target?: RemoteRepoTarget
  result: RemoteCommandResult
}): RemoteRepoRuntimeFailureError | null {
  const reason = remoteRuntimeFailureReasonFromCommandResult(input.result)
  if (!reason) return null
  return new RemoteRepoRuntimeFailureError({
    repoRoot: input.repoRoot,
    repoRuntimeId: input.repoRuntimeId,
    reason,
    target: input.target,
    message: input.result.message,
  })
}
