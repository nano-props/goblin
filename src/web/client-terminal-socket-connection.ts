import {
  createSocketRequestId,
  createTerminalWebSocketUrl,
  encodeClientMessage,
  parseTerminalSocketServerMessage,
} from '#/web/client-terminal-socket-utils.ts'
import type {
  AppRealtimeMessage,
  AppRealtimeRequestInputs,
  AppRealtimeResponseOutputs,
  AppRealtimeSocketServerMessage,
} from '#/shared/app-realtime-socket.ts'
import {
  createClientRealtimeSocketConnection,
  type ClientRealtimeSocketConnection,
} from '#/web/realtime/client-realtime-socket-connection.ts'

export interface TerminalSocketServerConfig {
  url: string
  accessToken: string
  clientId: string
}

interface TerminalSocketConnectionOptions {
  getServerConfig: () => TerminalSocketServerConfig
  hasRealtimeSubscribers: () => boolean
  onRealtimeMessage(message: AppRealtimeMessage, currentClientId: string): void
}

export type TerminalSocketConnection = ClientRealtimeSocketConnection<
  AppRealtimeRequestInputs,
  AppRealtimeResponseOutputs
>

export function createTerminalSocketConnection(options: TerminalSocketConnectionOptions): TerminalSocketConnection {
  return createClientRealtimeSocketConnection<
    AppRealtimeRequestInputs,
    AppRealtimeResponseOutputs,
    AppRealtimeSocketServerMessage,
    AppRealtimeMessage
  >({
    resolveConnection() {
      try {
        const server = options.getServerConfig()
        return {
          url: createTerminalWebSocketUrl(server.url, server.accessToken, server.clientId),
          clientId: server.clientId,
        }
      } catch {
        return null
      }
    },
    hasRealtimeSubscribers: options.hasRealtimeSubscribers,
    onRealtimeMessage: options.onRealtimeMessage,
    parseServerMessage: parseTerminalSocketServerMessage,
    encodeClientMessage,
    createRequestId: createSocketRequestId,
    errorPrefix: 'Terminal',
  })
}
