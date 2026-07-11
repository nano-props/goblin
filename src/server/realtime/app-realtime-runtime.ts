import { BufferedAppRealtimeSocket } from '#/server/realtime/buffered-app-realtime-socket.ts'
import type { RealtimeBroker, RealtimeSocket } from '#/server/realtime/realtime-broker.ts'
import type { ServerAppRealtimeDiagnostics, ServerAppRealtimeHost } from '#/server/realtime/app-realtime-host.ts'
import { serverLogger } from '#/server/logger.ts'
import {
  isAppRealtimeWorkspacePaneRuntimeAction,
  isAppRealtimeWorkspacePaneTabsAction,
  normalizeAppRealtimeClientMessage,
} from '#/shared/app-realtime-validators.ts'
import type { AppRealtimeClientMessage, AppRealtimeMessage } from '#/shared/app-realtime-socket.ts'
import type {
  TerminalSocketRequestAction,
  TerminalSocketRequestInputs,
  TerminalSocketRequestMessage,
  TerminalSocketResponseOutputs,
} from '#/shared/terminal-socket.ts'
import type {
  WorkspacePaneTabsSocketAction,
  WorkspacePaneTabsSocketRequestInputs,
  WorkspacePaneTabsSocketResponseOutputs,
} from '#/shared/workspace-pane-tabs.ts'
import {
  handleTerminalRealtimeRequestMessage,
  shouldPauseRealtimeRequest,
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
  WorkspacePaneRuntimeSocketAction,
  WorkspacePaneRuntimeSocketRequestInputs,
  WorkspacePaneRuntimeSocketResponseOutputs,
} from '#/shared/workspace-pane-runtime.ts'

type MaybePromise<T> = T | Promise<T>

const appRealtimeRuntimeLogger = serverLogger.child({ module: 'app-realtime-runtime' })

export interface AppRealtimeRuntimeOptions {
  broker: RealtimeBroker<AppRealtimeMessage>
  isValidClientId(value: unknown): value is string
  getDiagnostics(): ServerAppRealtimeDiagnostics
  terminalHandlers: {
    [TAction in TerminalSocketRequestAction]: (
      clientId: string,
      userId: string,
      input: TerminalSocketRequestInputs[TAction],
    ) => MaybePromise<TerminalSocketResponseOutputs[TAction]>
  }
  workspacePaneTabsHandlers: {
    [TAction in WorkspacePaneTabsSocketAction]: (
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsSocketRequestInputs[TAction],
    ) => MaybePromise<WorkspacePaneTabsSocketResponseOutputs[TAction]>
  }
  workspacePaneRuntimeHandlers: {
    [TAction in WorkspacePaneRuntimeSocketAction]: (
      clientId: string,
      userId: string,
      input: WorkspacePaneRuntimeSocketRequestInputs[TAction],
    ) => MaybePromise<WorkspacePaneRuntimeSocketResponseOutputs[TAction]>
  }
  onShutdown(): void
}

export function createAppRealtimeHost(options: AppRealtimeRuntimeOptions): ServerAppRealtimeHost {
  const { broker } = options
  const bufferedSocketByRawSocket = new WeakMap<RealtimeSocket, BufferedAppRealtimeSocket>()

  return {
    isValidClientId: options.isValidClientId,
    getDiagnostics: options.getDiagnostics,
    registerSocket(clientId, userId, socket) {
      if (typeof clientId !== 'string' || !options.isValidClientId(clientId) || !userId) {
        socket.close(1008, 'invalid client id')
        return
      }
      const rawSocket = socket as RealtimeSocket
      let buffered: BufferedAppRealtimeSocket
      buffered = new BufferedAppRealtimeSocket(rawSocket, () => {
        broker.unregisterSocket(buffered)
        bufferedSocketByRawSocket.delete(rawSocket)
      })
      bufferedSocketByRawSocket.set(rawSocket, buffered)
      broker.registerSocket(clientId, userId, buffered)
    },
    unregisterSocket(_clientId, _userId, socket) {
      const rawSocket = socket as RealtimeSocket
      const buffered = bufferedSocketByRawSocket.get(rawSocket) ?? rawSocket
      if (buffered instanceof BufferedAppRealtimeSocket) buffered.deactivate()
      broker.unregisterSocket(buffered)
      bufferedSocketByRawSocket.delete(rawSocket)
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
      if (message.type === 'heartbeat') {
        broker.recordHeartbeat(userId, clientId)
        return
      }
      if (message.type === 'ping') {
        broker.recordHeartbeat(userId, clientId)
        const rawSocket = socket as RealtimeSocket
        try {
          rawSocket.send(JSON.stringify({ type: 'pong', requestId: message.requestId }))
        } catch {
          bufferedSocketByRawSocket.get(rawSocket)?.deactivate()
        }
        return
      }
      const rawSocket = socket as RealtimeSocket
      const bufferedSocket = bufferedSocketByRawSocket.get(rawSocket)
      if (isAppRealtimeWorkspacePaneRuntimeAction(message.action)) {
        // Runtime open responses may carry an authoritative provider frame
        // (terminal currently does). Keep provider realtime behind that frame;
        // the handler resumes with the matching flush boundary.
        bufferedSocket?.pause()
        void handleWorkspacePaneRuntimeRealtimeRequestMessage(
          options.workspacePaneRuntimeHandlers,
          clientId,
          userId,
          rawSocket,
          message as WorkspacePaneRuntimeRealtimeRequestMessage,
          bufferedSocket,
        )
        return
      }
      if (isAppRealtimeWorkspacePaneTabsAction(message.action)) {
        void handleWorkspacePaneTabsRealtimeRequestMessage(
          options.workspacePaneTabsHandlers,
          clientId,
          userId,
          rawSocket,
          message as WorkspacePaneTabsRealtimeRequestMessage,
          () => bufferedSocket?.deactivate(),
        )
        return
      }
      const terminalMessage = message as TerminalSocketRequestMessage
      if (shouldPauseRealtimeRequest(terminalMessage.action)) bufferedSocket?.pause()
      void handleTerminalRealtimeRequestMessage(
        options.terminalHandlers,
        clientId,
        userId,
        rawSocket,
        bufferedSocket,
        terminalMessage,
      )
    },
    shutdown() {
      options.onShutdown()
    },
  }
}
