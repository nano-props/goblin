import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCatalogMutationResult,
  TerminalCreateInput,
  TerminalMutationResult,
  TerminalNotifyBellInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionInput,
  TerminalSessionSnapshot,
  TerminalSessionSnapshotInput,
  TerminalSessionSummary,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalWriteInput,
} from '#/shared/terminal.ts'

type MaybePromise<T> = T | Promise<T>

export interface ServerTerminalSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

export interface ServerTerminalWorkerFailureDiagnostics {
  kind: 'exit' | 'error' | 'send-failed'
  at: number
  detail: string
}

export type ServerTerminalHostState = 'idle' | 'running' | 'restarting' | 'shutting-down'

export interface ServerTerminalHostDiagnostics {
  mode: 'worker-backed'
  state: ServerTerminalHostState
  workerRunning: boolean
  workerPid: number | null
  workerStartedAt: number | null
  workerUptimeMs: number | null
  pendingRequests: number
  registeredSockets: number
  restartAttempts: number
  restartScheduled: boolean
  shuttingDown: boolean
  lastSuccessfulResponseAt: number | null
  lastExitCode: number | null
  lastExitSignal: NodeJS.Signals | null
  lastWorkerFailure: ServerTerminalWorkerFailureDiagnostics | null
}

export interface ServerTerminalHost {
  isValidClientId(value: unknown): value is string
  getDiagnostics(): MaybePromise<ServerTerminalHostDiagnostics>
  registerSocket(clientId: string, attachmentId: string, socket: ServerTerminalSocket): void
  unregisterSocket(clientId: string, attachmentId: string, socket: ServerTerminalSocket): void
  attach(clientId: string, input: TerminalAttachInput): MaybePromise<TerminalAttachResult>
  restart(clientId: string, input: TerminalRestartInput): MaybePromise<TerminalAttachResult>
  write(clientId: string, input: TerminalWriteInput): MaybePromise<TerminalMutationResult>
  resize(clientId: string, input: TerminalResizeInput): MaybePromise<TerminalMutationResult>
  takeover(clientId: string, input: TerminalTakeoverInput): MaybePromise<TerminalTakeoverResult>
  close(clientId: string, input: TerminalSessionInput): MaybePromise<TerminalMutationResult>
  notifyBell(clientId: string, input: TerminalNotifyBellInput): MaybePromise<TerminalMutationResult>
  listSessions(clientId: string, repoRoot: string): MaybePromise<TerminalSessionSummary[]>
  create(clientId: string, input: TerminalCreateInput): MaybePromise<TerminalCatalogMutationResult>
  prune(clientId: string, repoRoot: string): MaybePromise<{ pruned: number; remaining: number }>
  getSessionSnapshot(clientId: string, input: TerminalSessionSnapshotInput): MaybePromise<TerminalSessionSnapshot | null>
  /** Handle an incoming realtime message from a client socket. */
  handleRealtimeMessage(clientId: string, attachmentId: string, socket: ServerTerminalSocket, message: string): void
  shutdown(): void
}
