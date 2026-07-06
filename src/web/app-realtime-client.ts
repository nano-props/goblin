import type {
  AppRealtimeMessage,
  AppRealtimeRequestInputs,
  AppRealtimeResponseOutputs,
  AppRealtimeSocketServerMessage,
} from '#/shared/app-realtime-socket.ts'
import {
  createAppRealtimeRequestId,
  createAppRealtimeWebSocketUrl,
  encodeAppRealtimeClientMessage,
  parseAppRealtimeSocketServerMessage,
} from '#/web/app-realtime-socket-utils.ts'
import {
  createClientRealtimeSocketConnection,
  type ClientRealtimeSocketConnection,
} from '#/web/realtime/client-realtime-socket-connection.ts'

export interface AppRealtimeServerConfig {
  url: string
  accessToken: string
  clientId: string
}

export interface ClientAppRealtime {
  request: ClientRealtimeSocketConnection<AppRealtimeRequestInputs, AppRealtimeResponseOutputs>['request']
  prewarm: () => Promise<void>
  kickReconnect: () => void
  onMessage: (cb: (message: AppRealtimeMessage, currentClientId: string) => void) => () => void
  onRecovered: (cb: (currentClientId: string) => void) => () => void
}

export function createClientAppRealtime(options: {
  getServerConfig: () => AppRealtimeServerConfig
}): ClientAppRealtime {
  const messageSubscribers = new Set<(message: AppRealtimeMessage, currentClientId: string) => void>()
  const recoveredSubscribers = new Set<(currentClientId: string) => void>()
  let hasOpened = false

  const connection = createClientRealtimeSocketConnection<
    AppRealtimeRequestInputs,
    AppRealtimeResponseOutputs,
    AppRealtimeSocketServerMessage,
    AppRealtimeMessage
  >({
    resolveConnection() {
      try {
        const server = options.getServerConfig()
        return {
          url: createAppRealtimeWebSocketUrl(server.url, server.accessToken, server.clientId),
          clientId: server.clientId,
        }
      } catch {
        return null
      }
    },
    hasRealtimeSubscribers() {
      return messageSubscribers.size > 0 || recoveredSubscribers.size > 0
    },
    onOpen(currentClientId) {
      if (!hasOpened) {
        hasOpened = true
        return
      }
      for (const subscriber of recoveredSubscribers) subscriber(currentClientId)
    },
    onRealtimeMessage(message, currentClientId) {
      for (const subscriber of messageSubscribers) subscriber(message, currentClientId)
    },
    parseServerMessage: parseAppRealtimeSocketServerMessage,
    encodeClientMessage: encodeAppRealtimeClientMessage,
    createRequestId: createAppRealtimeRequestId,
    errorPrefix: 'App realtime',
  })

  return {
    request: connection.request,
    prewarm: connection.prewarm,
    kickReconnect: connection.kickReconnect,
    onMessage(cb) {
      messageSubscribers.add(cb)
      connection.openForRealtime()
      return () => {
        messageSubscribers.delete(cb)
        connection.closeSocketIfIdle()
      }
    },
    onRecovered(cb) {
      recoveredSubscribers.add(cb)
      connection.openForRealtime()
      return () => {
        recoveredSubscribers.delete(cb)
        connection.closeSocketIfIdle()
      }
    },
  }
}
