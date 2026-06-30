import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCreateResult,
  TerminalCreateInput,
  TerminalIdentityEvent,
  TerminalLifecycleEvent,
  TerminalListSessionsInput,
  TerminalListWorkspaceTabsInput,
  TerminalMutationResult,
  TerminalOutputEvent,
  TerminalReplaceWorkspaceTabsInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionInput,
  TerminalSessionSnapshot,
  TerminalSessionSnapshotInput,
  TerminalSessionSummary,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalWorkspaceTabsEntry,
  TerminalTitleEvent,
  TerminalExitEvent,
  TerminalWriteInput,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'

export type TerminalRealtimeMessage =
  | { type: 'output'; event: TerminalOutputEvent }
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
  | { type: 'workspace-tabs-changed'; repoRoot: string }
  // Targeted per-session close. Emitted by the server after a
  // successful `close` request, alongside the existing
  // `sessions-changed` global broadcast. Multi-window clients use
  // this to drop the local session immediately, without waiting for
  // a full list-rescan. The `repoRoot` is included so the client
  // can route the event to the right worktree without a manager
  // lookup.
  | {
      type: 'session-closed'
      ptySessionId: string
      repoRoot: string
      worktreePath: string
      tabs: WorkspacePaneTabEntry[]
    }

export interface TerminalSocketRequestInputs {
  attach: TerminalAttachInput
  restart: TerminalRestartInput
  write: TerminalWriteInput
  resize: TerminalResizeInput
  takeover: TerminalTakeoverInput
  close: TerminalSessionInput
  'list-sessions': TerminalListSessionsInput
  'list-workspace-tabs': TerminalListWorkspaceTabsInput
  create: TerminalCreateInput
  'replace-tabs': TerminalReplaceWorkspaceTabsInput
  prune: { repoRoot: string }
  'session-snapshot': TerminalSessionSnapshotInput
}

export interface TerminalSocketResponseOutputs {
  attach: TerminalAttachResult
  restart: TerminalAttachResult
  write: TerminalMutationResult
  resize: TerminalMutationResult
  takeover: TerminalTakeoverResult
  close: TerminalMutationResult
  'list-sessions': TerminalSessionSummary[]
  'list-workspace-tabs': TerminalWorkspaceTabsEntry[]
  create: TerminalCreateResult
  'replace-tabs': WorkspacePaneTabEntry[]
  prune: { pruned: number; remaining: number }
  'session-snapshot': TerminalSessionSnapshot | null
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

export type TerminalHealthPongMessage = { type: 'pong'; requestId: string }

export type TerminalSocketServerMessage =
  TerminalRealtimeMessage | TerminalSocketResponseMessage | TerminalHealthPongMessage
/**
 * Heartbeat envelope. Sent client→server every
 * `HEARTBEAT_INTERVAL_MS` while the realtime socket is `OPEN`. Carries
 * no payload — the server already knows the `(clientId, userId)` from
 * the upgrade — but a discriminating `type` keeps the union closed so
 * the existing `normalizeTerminalClientMessage` path rejects anything
 * malformed at the WS layer. The server uses the receipt time to drive
 * the broker's per-`clientId` liveness timer; a missed beat
 * (longer than `HEARTBEAT_DEADLINE_MS`) flips broker presence
 * offline so the next `attach` can auto-claim instead of being
 * stranded in viewer mode.
 */
export interface TerminalHeartbeatMessage {
  type: 'heartbeat'
}
export type TerminalHealthPingMessage = { type: 'ping'; requestId: string }
export type TerminalClientMessage = TerminalSocketRequestMessage | TerminalHeartbeatMessage | TerminalHealthPingMessage
