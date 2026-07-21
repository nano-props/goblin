import type {
  TerminalClientMessage,
  TerminalRealtimeMessage,
  TerminalSocketRequestInputs,
  TerminalSocketResponseOutputs,
} from '#/shared/terminal-socket.ts'
import type {
  WorkspacePaneTabsRealtimeMessage,
  WorkspacePaneTabsSocketRequestInputs,
  WorkspacePaneTabsSocketResponseOutputs,
} from '#/shared/workspace-pane-tabs.ts'
import type {
  WorkspacePaneRuntimeSocketRequestInputs,
  WorkspacePaneRuntimeSocketResponseOutputs,
} from '#/shared/workspace-pane-runtime.ts'
import type { RealtimeRpcRequestMessage, RealtimeRpcResponseMessage } from '#/shared/realtime-rpc.ts'

export type AppRealtimeMessage = TerminalRealtimeMessage | WorkspacePaneTabsRealtimeMessage

export interface AppRealtimeRequestInputs
  extends TerminalSocketRequestInputs, WorkspacePaneTabsSocketRequestInputs, WorkspacePaneRuntimeSocketRequestInputs {}

export interface AppRealtimeResponseOutputs
  extends
    TerminalSocketResponseOutputs,
    WorkspacePaneTabsSocketResponseOutputs,
    WorkspacePaneRuntimeSocketResponseOutputs {}

export type AppRealtimeRequestAction = keyof AppRealtimeRequestInputs

export type AppRealtimeRequestMessage = RealtimeRpcRequestMessage<AppRealtimeRequestInputs>

export type AppRealtimeResponseMessage = RealtimeRpcResponseMessage<
  AppRealtimeRequestInputs,
  AppRealtimeResponseOutputs
>

export type AppRealtimeHealthPongMessage = { type: 'pong'; requestId: string }

export type AppRealtimeSocketServerMessage =
  AppRealtimeMessage | AppRealtimeResponseMessage | AppRealtimeHealthPongMessage

/**
 * Heartbeat envelope. Sent client→server while the realtime socket is open.
 * The server already knows `(clientId, userId)` from the upgrade; this only
 * feeds broker liveness.
 */
export interface AppRealtimeHeartbeatMessage {
  type: 'heartbeat'
}

export type AppRealtimeHealthPingMessage = { type: 'ping'; requestId: string }

export type AppRealtimeClientMessage =
  TerminalClientMessage | AppRealtimeRequestMessage | AppRealtimeHeartbeatMessage | AppRealtimeHealthPingMessage
