import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalBellRealtimeEvent,
  TerminalIdentityEvent,
  TerminalLifecycleEvent,
  TerminalListSessionsInput,
  TerminalPruneInput,
  TerminalOutputEvent,
  TerminalResizeInput,
  TerminalResizeResult,
  TerminalRestartInput,
  TerminalRestartResult,
  TerminalSessionsSnapshot,
  TerminalSessionsChangedEvent,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalTitleEvent,
  TerminalExitEvent,
  TerminalWriteInput,
  TerminalWriteResult,
} from '#/shared/terminal-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { RealtimeRpcRequestMessage, RealtimeRpcResponseMessage } from '#/shared/realtime-rpc.ts'

export type TerminalRealtimeMessage =
  | { type: 'output'; event: TerminalOutputEvent }
  | { type: 'bell'; event: TerminalBellRealtimeEvent }
  | { type: 'title'; event: TerminalTitleEvent }
  | { type: 'exit'; event: TerminalExitEvent }
  // Identity and lifecycle are split at the wire. The client's
  // `applyIdentity` only sees the identity event; `applyLifecycle`
  // only sees the lifecycle event. A transitional phase update
  // (e.g. `'opening'` during a pre-spawn broadcast) cannot look
  // like a role change to the client.
  | { type: 'identity'; event: TerminalIdentityEvent }
  | { type: 'lifecycle'; event: TerminalLifecycleEvent }
  | ({ type: 'sessions-changed' } & TerminalSessionsChangedEvent)
  // Targeted per-session close. Emitted by the server after a
  // successful `close` request, alongside the existing
  // `sessions-changed` global broadcast. Multi-window clients use
  // this to drop the local session immediately, without waiting for
  // a full list-rescan. The workspace identity lets the client route
  // the event without a manager lookup.
  | {
      type: 'session-closed'
      terminalRuntimeSessionId: string
      terminalRuntimeGeneration: number
      terminalSessionId: string
      workspaceId: WorkspaceId
    }

export interface TerminalSocketRequestInputs {
  attach: TerminalAttachInput
  restart: TerminalRestartInput
  write: TerminalWriteInput
  resize: TerminalResizeInput
  takeover: TerminalTakeoverInput
  'recover-sessions': TerminalListSessionsInput
  prune: TerminalPruneInput
}

export interface TerminalSocketResponseOutputs {
  attach: TerminalAttachResult
  restart: TerminalRestartResult
  write: TerminalWriteResult
  resize: TerminalResizeResult
  takeover: TerminalTakeoverResult
  'recover-sessions': TerminalSessionsSnapshot
  prune: { pruned: number; remaining: number }
}

export type TerminalSocketRequestAction = keyof TerminalSocketRequestInputs

export type TerminalSocketRequestMessage = RealtimeRpcRequestMessage<TerminalSocketRequestInputs>

export type TerminalSocketResponseMessage = RealtimeRpcResponseMessage<
  TerminalSocketRequestInputs,
  TerminalSocketResponseOutputs
>

export type TerminalSocketServerMessage = TerminalRealtimeMessage | TerminalSocketResponseMessage
export type TerminalClientMessage = TerminalSocketRequestMessage
