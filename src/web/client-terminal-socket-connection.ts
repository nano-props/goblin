import {
  createSocketRequestId,
  createTerminalWebSocketUrl,
  encodeClientMessage,
  parseTerminalSocketServerMessage,
} from '#/web/client-terminal-socket-utils.ts'
import type {
  TerminalRealtimeMessage,
  TerminalSocketRequestInputs,
  TerminalSocketResponseOutputs,
  TerminalSocketServerMessage,
} from '#/shared/terminal-socket.ts'
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
  onRealtimeMessage(message: TerminalRealtimeMessage, currentClientId: string): void
}

export type TerminalSocketConnection = ClientRealtimeSocketConnection<
  TerminalSocketRequestInputs,
  TerminalSocketResponseOutputs
>

export function createTerminalSocketConnection(options: TerminalSocketConnectionOptions): TerminalSocketConnection {
  return createClientRealtimeSocketConnection<
    TerminalSocketRequestInputs,
    TerminalSocketResponseOutputs,
    TerminalSocketServerMessage,
    TerminalRealtimeMessage
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
