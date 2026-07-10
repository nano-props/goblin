import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalBellRealtimeEvent,
  TerminalIdentityEvent,
  TerminalLifecycleEvent,
  TerminalListSessionsInput,
  TerminalPruneInput,
  TerminalMutationResult,
  TerminalOutputEvent,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionInput,
  TerminalSessionSummary,
  TerminalSessionsRecoveryResult,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalTitleEvent,
  TerminalExitEvent,
  TerminalWriteInput,
} from '#/shared/terminal-types.ts'

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
  | { type: 'sessions-changed'; repoRoot: string }
  // Targeted per-session close. Emitted by the server after a
  // successful `close` request, alongside the existing
  // `sessions-changed` global broadcast. Multi-window clients use
  // this to drop the local session immediately, without waiting for
  // a full list-rescan. The `repoRoot` is included so the client
  // can route the event to the right worktree without a manager
  // lookup.
  | {
      type: 'session-closed'
      terminalRuntimeSessionId: string
      terminalSessionId: string
      repoRoot: string
      worktreePath: string
    }

export interface TerminalSocketRequestInputs {
  attach: TerminalAttachInput
  restart: TerminalRestartInput
  write: TerminalWriteInput
  resize: TerminalResizeInput
  takeover: TerminalTakeoverInput
  close: TerminalSessionInput
  'list-sessions': TerminalListSessionsInput
  'recover-sessions': TerminalListSessionsInput
  prune: TerminalPruneInput
}

export interface TerminalSocketResponseOutputs {
  attach: TerminalAttachResult
  restart: TerminalAttachResult
  write: TerminalMutationResult
  resize: TerminalMutationResult
  takeover: TerminalTakeoverResult
  close: TerminalMutationResult
  'list-sessions': TerminalSessionSummary[]
  'recover-sessions': TerminalSessionsRecoveryResult
  prune: { pruned: number; remaining: number }
}

export type TerminalSocketRequestAction = keyof TerminalSocketRequestInputs

export type TerminalSocketRequestMessage = {
  [TAction in TerminalSocketRequestAction]: {
    type: 'request'
    requestId: string
    action: TAction
    input: TerminalSocketRequestInputs[TAction]
  }
}[TerminalSocketRequestAction]

export type TerminalSocketResponseMessage =
  | {
      [TAction in TerminalSocketRequestAction]: {
        type: 'response'
        requestId: string
        ok: true
        action: TAction
        payload: TerminalSocketResponseOutputs[TAction]
      }
    }[TerminalSocketRequestAction]
  | {
      [TAction in TerminalSocketRequestAction]: {
        type: 'response'
        requestId: string
        ok: false
        action: TAction
        error: string
      }
    }[TerminalSocketRequestAction]

export type TerminalSocketServerMessage = TerminalRealtimeMessage | TerminalSocketResponseMessage
export type TerminalClientMessage = TerminalSocketRequestMessage
