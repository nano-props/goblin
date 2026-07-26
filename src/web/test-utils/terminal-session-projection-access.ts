import type {
  TerminalBellRealtimeEvent,
  TerminalProjectionEffect,
  TerminalSessionSummary,
  WorkspaceRuntimeScope,
} from '#/shared/terminal-types.ts'
import type { FutureExitLedger } from '#/web/components/terminal/future-exit-ledger.ts'
import type { TerminalBellState } from '#/web/components/terminal/terminal-bell-state.ts'
import type { TerminalSession } from '#/web/components/terminal/TerminalSession.ts'
import type { TerminalSessionProjection } from '#/web/components/terminal/TerminalSessionProjection.ts'
import type { TerminalSessionRuntime } from '#/web/components/terminal/terminal-session-runtime.ts'
import type { TerminalDescriptor, TerminalSnapshot } from '#/web/components/terminal/types.ts'

interface TerminalSessionProjectionTestAccess {
  readonly sessions: Map<string, TerminalSession>
  readonly lifecycleQueues: { hasCreate(terminalFilesystemTargetKey: string): boolean }
  readonly snapshotCache: Map<string, TerminalSnapshot>
  readonly pendingServerBellByRuntimeBindingKey: Map<string, TerminalBellRealtimeEvent>
  readonly futureExitOrphans: FutureExitLedger
  readonly bellState: TerminalBellState
  applyServerSessionEffect(
    scope: WorkspaceRuntimeScope,
    effect: TerminalProjectionEffect,
    serverSession: TerminalSessionSummary,
    clientId: string,
  ): boolean
  notifySession(terminalSessionId: string): void
  ensureSession(descriptor: TerminalDescriptor): TerminalSession
  removeSession(terminalSessionId: string, options: { dispose: boolean; preserveFutureExits?: boolean }): boolean
}

/** Typed test seam for failure-path tests that deliberately perturb private projection indexes. */
export function terminalSessionProjectionAccess(
  projection: TerminalSessionProjection,
): TerminalSessionProjectionTestAccess {
  return projection as unknown as TerminalSessionProjectionTestAccess
}

export function requiredTerminalSession(
  projection: TerminalSessionProjection,
  terminalSessionId: string,
): TerminalSession {
  const session = terminalSessionProjectionAccess(projection).sessions.get(terminalSessionId)
  if (!session) throw new Error(`Missing terminal session fixture: ${terminalSessionId}`)
  return session
}

/** Typed access to runtime failure injection used by projection recovery tests. */
export function terminalSessionRuntimeAccess(session: TerminalSession): { runtime: TerminalSessionRuntime } {
  return session as unknown as { runtime: TerminalSessionRuntime }
}
