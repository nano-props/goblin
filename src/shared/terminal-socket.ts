import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCatalogMutationResult,
  TerminalCreateInput,
  TerminalListSessionsInput,
  TerminalMutationResult,
  TerminalOutputEvent,
  TerminalOwnershipEvent,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSlotInput,
  TerminalSlotSnapshot,
  TerminalSlotSnapshotInput,
  TerminalSlotSummary,
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
  // Targeted per-slot close. Emitted by the server after a
  // successful `close` request, alongside the existing
  // `sessions-changed` global broadcast. Multi-window clients use
  // this to drop the local slot immediately, without waiting for
  // a full list-rescan. The `repoRoot` is included so the renderer
  // can route the event to the right worktree without a manager
  // lookup.
  | { type: 'slot-closed'; ptySessionId: string; repoRoot: string }

export interface TerminalSocketRequestInputs {
  attach: TerminalAttachInput
  restart: TerminalRestartInput
  write: TerminalWriteInput
  resize: TerminalResizeInput
  takeover: TerminalTakeoverInput
  close: TerminalSlotInput
  'list-sessions': TerminalListSessionsInput
  create: TerminalCreateInput
  prune: { repoRoot: string }
  'slot-snapshot': TerminalSlotSnapshotInput
}

export interface TerminalSocketResponseOutputs {
  attach: TerminalAttachResult
  restart: TerminalAttachResult
  write: TerminalMutationResult
  resize: TerminalMutationResult
  takeover: TerminalTakeoverResult
  close: TerminalMutationResult
  'list-sessions': TerminalSlotSummary[]
  create: TerminalCatalogMutationResult
  prune: { pruned: number; remaining: number }
  'slot-snapshot': TerminalSlotSnapshot | null
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
