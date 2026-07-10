import type {
  TerminalClientMessage,
  TerminalRealtimeMessage,
  TerminalSocketRequestInputs,
  TerminalSocketRequestMessage,
  TerminalSocketResponseMessage,
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

export type AppRealtimeMessage = TerminalRealtimeMessage | WorkspacePaneTabsRealtimeMessage

export interface AppRealtimeRequestInputs
  extends TerminalSocketRequestInputs, WorkspacePaneTabsSocketRequestInputs, WorkspacePaneRuntimeSocketRequestInputs {}

export interface AppRealtimeResponseOutputs
  extends
    TerminalSocketResponseOutputs,
    WorkspacePaneTabsSocketResponseOutputs,
    WorkspacePaneRuntimeSocketResponseOutputs {}

export type AppRealtimeRequestAction = keyof AppRealtimeRequestInputs

export type AppRealtimeRequestMessage =
  | TerminalSocketRequestMessage
  | {
      [TAction in keyof WorkspacePaneTabsSocketRequestInputs]: {
        type: 'request'
        requestId: string
        action: TAction
        input: WorkspacePaneTabsSocketRequestInputs[TAction]
      }
    }[keyof WorkspacePaneTabsSocketRequestInputs]
  | {
      [TAction in keyof WorkspacePaneRuntimeSocketRequestInputs]: {
        type: 'request'
        requestId: string
        action: TAction
        input: WorkspacePaneRuntimeSocketRequestInputs[TAction]
      }
    }[keyof WorkspacePaneRuntimeSocketRequestInputs]

export type AppRealtimeResponseMessage =
  | TerminalSocketResponseMessage
  | {
      [TAction in keyof WorkspacePaneTabsSocketRequestInputs]: {
        type: 'response'
        requestId: string
        ok: true
        action: TAction
        payload: WorkspacePaneTabsSocketResponseOutputs[TAction]
      }
    }[keyof WorkspacePaneTabsSocketRequestInputs]
  | {
      [TAction in keyof WorkspacePaneRuntimeSocketRequestInputs]: {
        type: 'response'
        requestId: string
        ok: true
        action: TAction
        payload: WorkspacePaneRuntimeSocketResponseOutputs[TAction]
      }
    }[keyof WorkspacePaneRuntimeSocketRequestInputs]
  | {
      [TAction in keyof WorkspacePaneTabsSocketRequestInputs]: {
        type: 'response'
        requestId: string
        ok: false
        action: TAction
        error: string
      }
    }[keyof WorkspacePaneTabsSocketRequestInputs]
  | {
      [TAction in keyof WorkspacePaneRuntimeSocketRequestInputs]: {
        type: 'response'
        requestId: string
        ok: false
        action: TAction
        error: string
      }
    }[keyof WorkspacePaneRuntimeSocketRequestInputs]

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
