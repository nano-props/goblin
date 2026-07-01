import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCreateResult,
  TerminalCreateInput,
  TerminalMutationResult,
  TerminalReplaceWorkspaceTabsInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionInput,
  TerminalSessionSnapshot,
  TerminalSessionSnapshotInput,
  TerminalSessionSummary,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalUpdateWorkspaceTabsInput,
  WorkspacePaneTabsEntry,
  TerminalWriteInput,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'

type MaybePromise<T> = T | Promise<T>

// Re-export the broker's socket interface as the host's socket
// interface. They are structurally identical; the host's contract
// for a realtime socket is the same as the broker's contract for
// one. Defining the alias here (instead of duplicating the shape)
// keeps the two layers in lockstep when the wire protocol grows.
import type { TerminalRealtimeSocket } from '#/server/terminal/terminal-realtime-broker.ts'
export type { TerminalRealtimeSocket }
export type ServerTerminalSocket = TerminalRealtimeSocket

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

export interface ServerTerminalHost {
  isValidClientId(value: unknown): value is string
  getDiagnostics(): ServerTerminalHostDiagnostics
  /**
   * `true` when the realtime broker reports the `(userId, clientId)`
   * presence online. A raw socket can remain registered while this is
   * `false` if heartbeat deadlines have marked the client offline.
   */
  isClientOnline(userId: string, clientId: string): boolean
  // `clientId` is a per-tab routing identifier (broker key, WS
  // query param, sessionStorage value). `userId` is a per-token
  // identity derived from the access token; it partitions the
  // in-memory session store so the same token shared across
  // browsers sees the same terminals. See `identity.ts` for the
  // full model. Both must be threaded explicitly at the host
  // boundary so the two identifiers cannot be conflated.
  registerSocket(clientId: string, userId: string, socket: ServerTerminalSocket): void
  unregisterSocket(clientId: string, userId: string, socket: ServerTerminalSocket): void
  attach(clientId: string, userId: string, input: TerminalAttachInput): MaybePromise<TerminalAttachResult>
  restart(clientId: string, userId: string, input: TerminalRestartInput): MaybePromise<TerminalAttachResult>
  write(clientId: string, userId: string, input: TerminalWriteInput): MaybePromise<TerminalMutationResult>
  resize(clientId: string, userId: string, input: TerminalResizeInput): MaybePromise<TerminalMutationResult>
  takeover(clientId: string, userId: string, input: TerminalTakeoverInput): MaybePromise<TerminalTakeoverResult>
  close(clientId: string, userId: string, input: TerminalSessionInput): MaybePromise<TerminalMutationResult>
  listSessions(clientId: string, userId: string, repoRoot: string): MaybePromise<TerminalSessionSummary[]>
  listWorkspaceTabs(clientId: string, userId: string, repoRoot: string): MaybePromise<WorkspacePaneTabsEntry[]>
  create(clientId: string, userId: string, input: TerminalCreateInput): MaybePromise<TerminalCreateResult>
  replaceTabs(clientId: string, userId: string, input: TerminalReplaceWorkspaceTabsInput): MaybePromise<WorkspacePaneTabEntry[]>
  updateTabs(clientId: string, userId: string, input: TerminalUpdateWorkspaceTabsInput): MaybePromise<WorkspacePaneTabEntry[]>
  prune(clientId: string, userId: string, repoRoot: string): MaybePromise<{ pruned: number; remaining: number }>
  getSessionSnapshot(
    clientId: string,
    userId: string,
    input: TerminalSessionSnapshotInput,
  ): MaybePromise<TerminalSessionSnapshot | null>
  /** Handle an incoming realtime message from a client socket. */
  handleRealtimeMessage(clientId: string, userId: string, socket: ServerTerminalSocket, message: string): void
  shutdown(): void
}
