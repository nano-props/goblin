import { BufferedAppRealtimeSocket } from '#/server/realtime/buffered-app-realtime-socket.ts'
import type { RealtimeBroker } from '#/server/realtime/realtime-broker.ts'
import type {
  ServerAppRealtimeDiagnostics,
  ServerAppRealtimeHost,
  ServerAppRealtimeSocket,
} from '#/server/realtime/app-realtime-host.ts'
import { MemoryBoundRealtimeSocket } from '#/server/realtime/memory-bound-realtime-socket.ts'
import { serverLogger } from '#/server/logger.ts'
import {
  isAppRealtimeWorkspacePaneRuntimeAction,
  isAppRealtimeWorkspacePaneTabsAction,
  normalizeAppRealtimeClientMessage,
} from '#/shared/app-realtime-validators.ts'
import type { AppRealtimeClientMessage, AppRealtimeMessage } from '#/shared/app-realtime-socket.ts'
import type {
  TerminalSocketRequestInputs,
  TerminalSocketRequestMessage,
  TerminalSocketResponseOutputs,
} from '#/shared/terminal-socket.ts'
import type {
  WorkspacePaneTabsSocketRequestInputs,
  WorkspacePaneTabsSocketResponseOutputs,
} from '#/shared/workspace-pane-tabs.ts'
import {
  handleTerminalRealtimeRequestMessage,
  requiresRealtimeOrdering,
} from '#/server/terminal/terminal-runtime-realtime.ts'
import {
  handleWorkspacePaneTabsRealtimeRequestMessage,
  type WorkspacePaneTabsRealtimeRequestMessage,
} from '#/server/workspace-pane/workspace-pane-tabs-runtime-realtime.ts'
import {
  handleWorkspacePaneRuntimeRealtimeRequestMessage,
  type WorkspacePaneRuntimeRealtimeRequestMessage,
} from '#/server/workspace-pane/workspace-pane-runtime-realtime.ts'
import type {
  WorkspacePaneRuntimeSocketRequestInputs,
  WorkspacePaneRuntimeSocketResponseOutputs,
} from '#/shared/workspace-pane-runtime.ts'
import type { RealtimeRpcHandlers } from '#/server/realtime/realtime-rpc-handlers.ts'

const appRealtimeRuntimeLogger = serverLogger.child({ module: 'app-realtime-runtime' })

export interface AppRealtimeRuntimeOptions {
  broker: RealtimeBroker<AppRealtimeMessage>
  isValidClientId(value: unknown): value is string
  getDiagnostics(): ServerAppRealtimeDiagnostics
  terminalHandlers: RealtimeRpcHandlers<TerminalSocketRequestInputs, TerminalSocketResponseOutputs>
  workspacePaneTabsHandlers: RealtimeRpcHandlers<
    WorkspacePaneTabsSocketRequestInputs,
    WorkspacePaneTabsSocketResponseOutputs
  >
  workspacePaneRuntimeHandlers: RealtimeRpcHandlers<
    WorkspacePaneRuntimeSocketRequestInputs,
    WorkspacePaneRuntimeSocketResponseOutputs
  >
  onShutdown(): void
}

export function createAppRealtimeHost(options: AppRealtimeRuntimeOptions): ServerAppRealtimeHost {
  const { broker } = options
  const socketBindingByRawSocket = new WeakMap<
    ServerAppRealtimeSocket,
    { transport: MemoryBoundRealtimeSocket; buffered: BufferedAppRealtimeSocket }
  >()

  return {
    isValidClientId: options.isValidClientId,
    getDiagnostics: options.getDiagnostics,
    registerSocket(clientId, userId, socket) {
      if (typeof clientId !== 'string' || !options.isValidClientId(clientId) || !userId) {
        socket.close(1008, 'invalid client id')
        return
      }
      const transport = new MemoryBoundRealtimeSocket(socket)
      let buffered: BufferedAppRealtimeSocket
      buffered = new BufferedAppRealtimeSocket(transport, () => {
        broker.unregisterSocket(buffered)
        socketBindingByRawSocket.delete(socket)
      })
      socketBindingByRawSocket.set(socket, { transport, buffered })
      try {
        broker.registerSocket(clientId, userId, buffered)
      } catch (error) {
        buffered.release()
        throw error
      }
    },
    unregisterSocket(_clientId, _userId, socket) {
      socketBindingByRawSocket.get(socket)?.buffered.release()
    },
    handleRealtimeMessage(clientId, userId, socket, payload) {
      if (typeof clientId !== 'string' || !options.isValidClientId(clientId)) {
        appRealtimeRuntimeLogger.warn({ clientId }, 'invalid realtime message: missing/invalid identifiers')
        return
      }
      if (!userId) {
        appRealtimeRuntimeLogger.warn({ clientId }, 'invalid realtime message: missing userId from auth context')
        return
      }
      let message: AppRealtimeClientMessage | null = null
      try {
        message = normalizeAppRealtimeClientMessage(JSON.parse(payload))
      } catch (err) {
        appRealtimeRuntimeLogger.warn({ clientId, err }, 'invalid realtime message: parse/normalize failed')
        return
      }
      if (!message) {
        appRealtimeRuntimeLogger.warn({ clientId }, 'invalid realtime message: null after normalize')
        return
      }
      const binding = socketBindingByRawSocket.get(socket)
      if (!binding) return
      const { transport, buffered } = binding
      if (message.type === 'heartbeat') {
        broker.recordHeartbeat(buffered)
        return
      }
      if (message.type === 'ping') {
        broker.recordHeartbeat(buffered)
        try {
          transport.send(JSON.stringify({ type: 'pong', requestId: message.requestId }))
        } catch {
          buffered.forceClose(1011, 'realtime ping failed')
        }
        return
      }
      if (isAppRealtimeWorkspacePaneRuntimeAction(message.action)) {
        buffered.enqueueTransition(() =>
          handleWorkspacePaneRuntimeRealtimeRequestMessage(
            options.workspacePaneRuntimeHandlers,
            clientId,
            userId,
            transport,
            message as WorkspacePaneRuntimeRealtimeRequestMessage,
          ),
        )
        return
      }
      if (isAppRealtimeWorkspacePaneTabsAction(message.action)) {
        void handleWorkspacePaneTabsRealtimeRequestMessage(
          options.workspacePaneTabsHandlers,
          clientId,
          userId,
          transport,
          message as WorkspacePaneTabsRealtimeRequestMessage,
          () => buffered.forceClose(1011, 'realtime request failed'),
        )
        return
      }
      const terminalMessage = message as TerminalSocketRequestMessage
      const handleTerminalRequest = () =>
        handleTerminalRealtimeRequestMessage(options.terminalHandlers, clientId, userId, transport, terminalMessage)
      if (requiresRealtimeOrdering(terminalMessage.action)) {
        buffered.enqueueTransition(handleTerminalRequest)
        return
      }
      void handleTerminalRequest().catch(() => buffered.forceClose(1011, 'realtime request failed'))
    },
    shutdown() {
      options.onShutdown()
    },
  }
}
