import type { ServerTerminalHostDiagnostics } from '#/server/terminal/terminal-host.ts'
import type { RealtimeSocket } from '#/server/realtime/realtime-broker.ts'

export interface ServerAppRealtimeSocket extends RealtimeSocket {
  readonly bufferedAmount: number
  terminate(): void
}

export interface ServerAppRealtimeDiagnostics {
  terminal: ServerTerminalHostDiagnostics
}

export interface ServerAppRealtimeHost {
  isValidClientId(value: unknown): value is string
  getDiagnostics(): ServerAppRealtimeDiagnostics
  registerSocket(clientId: string, userId: string, socket: ServerAppRealtimeSocket): void
  unregisterSocket(clientId: string, userId: string, socket: ServerAppRealtimeSocket): void
  handleRealtimeMessage(clientId: string, userId: string, socket: ServerAppRealtimeSocket, message: string): void
  shutdown(): void
}
