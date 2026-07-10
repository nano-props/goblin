import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCreateInput,
  TerminalCreateResult,
  TerminalListSessionsInput,
  TerminalPruneInput,
  TerminalMutationResult,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionInput,
  TerminalSessionSummary,
  TerminalSessionsRecoveryResult,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalWriteInput,
} from '#/shared/terminal-types.ts'

type MaybePromise<T> = T | Promise<T>

// Re-export the broker's socket interface as the host's socket
// interface. They are structurally identical; the host's contract
// for a realtime socket is the same as the broker's contract for
// one. Defining the alias here (instead of duplicating the shape)
// keeps the two layers in lockstep when the wire protocol grows.
import type { ServerAppRealtimeHost, ServerAppRealtimeSocket } from '#/server/realtime/app-realtime-host.ts'
export type TerminalRealtimeSocket = ServerAppRealtimeSocket
export type ServerTerminalSocket = ServerAppRealtimeSocket

export type ServerTerminalHostState = 'running' | 'shutting-down'

export type PtySupervisorMode = 'in-process' | 'worker-backed'

export type PtySupervisorState = 'idle' | 'running' | 'restarting' | 'shutting-down'

export interface PtySupervisorFailureDiagnostics {
  kind: 'exit' | 'error' | 'send-failed' | 'spawn-failed'
  at: number
  detail: string
}

export interface PtySupervisorDiagnostics {
  mode: PtySupervisorMode
  state: PtySupervisorState
  workerRunning: boolean
  workerPid: number | null
  workerStartedAt: number | null
  workerUptimeMs: number | null
  pendingRequests: number
  restartAttempts: number
  restartScheduled: boolean
  shuttingDown: boolean
  lastSuccessfulResponseAt: number | null
  lastExitCode: number | null
  lastExitSignal: NodeJS.Signals | null
  lastFailure: PtySupervisorFailureDiagnostics | null
}

export interface ServerTerminalHostDiagnostics {
  mode: PtySupervisorMode
  state: ServerTerminalHostState
  registeredSockets: number
  shuttingDown: boolean
  pty: PtySupervisorDiagnostics
  /**
   * T4.1: aggregate stats across all live terminal sessions.
   * `liveSessionCount` is the number of in-memory sessions owned by
   * the manager; `totalRingBufferChars` and `maxRingBufferChars` are
   * the sum and the maximum per-session replay buffer size, in
   * JavaScript string chars (close to bytes for ASCII-heavy terminal
   * output; an upper bound is `chars * 2` for full UTF-16).
   */
  liveSessionCount: number
  totalRingBufferChars: number
  maxRingBufferChars: number
}

export interface ServerTerminalActionHost {
  /** Terminal lifecycle helper used by manager/tests; not part of the app realtime route contract. */
  isClientOnline(userId: string, clientId: string): boolean
  attach(clientId: string, userId: string, input: TerminalAttachInput): MaybePromise<TerminalAttachResult>
  restart(clientId: string, userId: string, input: TerminalRestartInput): MaybePromise<TerminalAttachResult>
  write(clientId: string, userId: string, input: TerminalWriteInput): MaybePromise<TerminalMutationResult>
  resize(clientId: string, userId: string, input: TerminalResizeInput): MaybePromise<TerminalMutationResult>
  takeover(clientId: string, userId: string, input: TerminalTakeoverInput): MaybePromise<TerminalTakeoverResult>
  close(clientId: string, userId: string, input: TerminalSessionInput): MaybePromise<TerminalMutationResult>
  /** Internal application/test read; intentionally not exposed as a realtime action. */
  listSessions(
    clientId: string,
    userId: string,
    input: TerminalListSessionsInput,
  ): MaybePromise<TerminalSessionSummary[]>
  recoverSessions(
    clientId: string,
    userId: string,
    input: TerminalListSessionsInput,
  ): MaybePromise<TerminalSessionsRecoveryResult>
  prune(
    clientId: string,
    userId: string,
    input: TerminalPruneInput,
  ): MaybePromise<{ pruned: number; remaining: number }>
}

/**
 * Internal terminal runtime surface. `create` intentionally does not belong
 * to `ServerTerminalActionHost`, so it cannot be registered as a client
 * realtime action; workspace-pane application commands call it in-process.
 */
export interface ServerTerminalHost extends ServerAppRealtimeHost, ServerTerminalActionHost {
  create(clientId: string, userId: string, input: TerminalCreateInput): MaybePromise<TerminalCreateResult>
}
