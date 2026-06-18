import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCatalogMutationResult,
  TerminalCreateInput,
  TerminalListSessionsInput,
  TerminalMutationResult,
  TerminalOutputEvent,
  TerminalOwnershipEvent,
  TerminalReorderInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionInput,
  TerminalSessionSnapshot,
  TerminalSessionSnapshotInput,
  TerminalSessionSummary,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalTitleEvent,
  TerminalExitEvent,
  TerminalWriteInput,
} from '#/shared/terminal-types.ts'

export type TerminalRealtimeMessage =
  | { type: 'output'; event: TerminalOutputEvent }
  | { type: 'title'; event: TerminalTitleEvent }
  | { type: 'exit'; event: TerminalExitEvent }
  | { type: 'ownership'; event: TerminalOwnershipEvent }
  | { type: 'sessions-changed'; repoRoot: string }
  // Targeted per-session close. Emitted by the server after a
  // successful `close` request, alongside the existing
  // `sessions-changed` global broadcast. Multi-window clients use
  // this to drop the local session immediately, without waiting for
  // a full list-rescan. The `repoRoot` is included so the renderer
  // can route the event to the right worktree without a manager
  // lookup.
  | { type: 'session-closed'; sessionId: string; repoRoot: string }

export interface TerminalSocketRequestInputs {
  attach: TerminalAttachInput
  restart: TerminalRestartInput
  write: TerminalWriteInput
  resize: TerminalResizeInput
  takeover: TerminalTakeoverInput
  close: TerminalSessionInput
  'list-sessions': TerminalListSessionsInput
  create: TerminalCreateInput
  prune: { repoRoot: string }
  'session-snapshot': TerminalSessionSnapshotInput
  reorder: TerminalReorderInput
}

export interface TerminalSocketResponseOutputs {
  attach: TerminalAttachResult
  restart: TerminalAttachResult
  write: TerminalMutationResult
  resize: TerminalMutationResult
  takeover: TerminalTakeoverResult
  close: TerminalMutationResult
  'list-sessions': TerminalSessionSummary[]
  create: TerminalCatalogMutationResult
  prune: { pruned: number; remaining: number }
  'session-snapshot': TerminalSessionSnapshot | null
  reorder: TerminalMutationResult
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
