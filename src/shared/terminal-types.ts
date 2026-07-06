import type { WorkspacePaneStaticTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'

/**
 * `controllerStatus === 'connected'` while the broker reports the
 * controller client online. Disconnects and missed heartbeats make the
 * effective controller `none`; server-side controller intent is tracked
 * separately from this wire-facing status.
 */
export type TerminalControllerStatus = 'connected' | 'none'
export type TerminalClientRole = 'controller' | 'viewer' | 'unowned'
export type TerminalSessionPhase = 'opening' | 'restarting' | 'open' | 'error' | 'closed'

export interface TerminalResolvedController {
  role: TerminalClientRole
  controllerStatus: TerminalControllerStatus
}

export interface TerminalController {
  clientId: string
  status: Exclude<TerminalControllerStatus, 'none'>
}

export interface TerminalSessionBase {
  repoRoot: string
  branch: string
  worktreePath: string
  repoInstanceId?: string
}

export interface RepoInstanceRuntimeInput {
  repoRoot: string
  repoInstanceId: string
}

export interface TerminalAttachInput {
  /**
   * Server terminal-runtime identity used to address attach/write/resize/
   * restart/close/takeover and terminal realtime events. Callers must not
   * infer that a live PTY handle exists from this field alone. `phase`
   * plus server-side PTY binding/authority checks decide whether the
   * session is currently interactive.
   */
  terminalRuntimeSessionId: string
  cols: number
  rows: number
  clientId?: string
}

export interface TerminalCreateInput {
  repoRoot: string
  repoInstanceId: string
  branch: string
  worktreePath: string
  kind: 'primary' | 'additional'
  /**
   * Shell text to run as the terminal starts, before returning to an interactive shell.
   * The initial cols/rows are a best-effort client hint; width-sensitive output may render
   * before the attached xterm reports its first authoritative fit/resize.
   */
  startupShellCommand?: string
  cols?: number
  rows?: number
  clientId?: string
  /**
   * Optional workspace pane tab identity to anchor the new terminal tab after.
   * When omitted or null, the new tab appends to the end of the strip.
   * See `docs/workspace-tab-opener.md`.
   */
  insertAfterIdentity?: string | null
}

export interface TerminalRestartInput {
  /**
   * Runtime lookup id for the session being restarted. Restart failure keeps
   * this id addressable in `phase: 'error'` so the client can retry without
   * changing the durable `terminalSessionId`.
   */
  terminalRuntimeSessionId: string
  cols: number
  rows: number
  clientId?: string
}

/**
 * Successful `takeover` result.
 *
 * First-frame contract: takeover is the authoritative handshake for
 * the new controller's view. The client applies the response
 * synchronously and does not need to wait for a follow-up realtime
 * `identity` event before painting the post-takeover frame. The
 * fields mirror `TerminalFirstFrame` minus the snapshot fields
 * (`snapshot`, `snapshotSeq`) — takeover does not return a fresh
 * snapshot because the new controller keeps the buffer the viewer
 * was already showing (no re-fetch needed).
 *
 * The realtime `identity` event still has a real job on the
 * non-takeover controller-change paths (controller crash, grace
 * expiry, etc.). For those paths there is no response to be
 * authoritative; the event remains the source of truth. Both
 * surfaces now carry the same fields so the client can apply
 * either without re-checking what shape arrived.
 */
export type TerminalTakeoverResult =
  | {
      ok: true
      terminalRuntimeSessionId: string
      role: 'controller' | 'viewer' | 'unowned'
      controllerStatus: 'connected' | 'none'
      controller: TerminalController | null
      canonicalCols: number
      canonicalRows: number
      phase: TerminalSessionPhase
    }
  | { ok: false; message: string }

/**
 * Successful attach/restart result.
 *
 * `snapshot`/`snapshotSeq` are the session's server-side serialized
 * xterm screen and the last PTY output sequence included in that screen.
 * The client hydrates from these and re-replays any post-snapshot
 * events the runtime captures.
 *
 * First-frame contract: a successful `attach`/`restart` response is
 * the authoritative handshake for that session's frame state. All
 * fields are required at the type level — the server must populate
 * them on every success path, and the client can hydrate the UI
 * without waiting for any follow-up event. This mirrors the R0
 * first-frame atomicity contract for `create` (see
 * `docs/terminal-session-lifecycle.md` §R0).
 */
export type TerminalAttachResult =
  | {
      ok: true
      terminalRuntimeSessionId: string
      processName: string
      canonicalTitle: string | null
      phase: TerminalSessionPhase
      message: string | null
      snapshot: string
      snapshotSeq: number
      controller: TerminalController | null
      canonicalCols: number
      canonicalRows: number
    }
  | { ok: false; message: string }

export type TerminalCreateAction = 'created' | 'restored' | 'reused'

/**
 * `create` carries the same first-frame fields as `attach`/`restart`
 * — the client must be able to paint without a follow-up snapshot
 * fetch. The shared `TerminalFirstFrame` shape below is the single
 * source of truth for the first-frame contract.
 */
export interface TerminalFirstFrame {
  terminalRuntimeSessionId: string
  processName: string
  canonicalTitle: string | null
  phase: TerminalSessionPhase
  message: string | null
  snapshot: string
  snapshotSeq: number
  controller: TerminalController | null
  canonicalCols: number
  canonicalRows: number
}

export type TerminalCreateResult =
  | ({
      ok: true
      action: TerminalCreateAction
      terminalSessionId: string
      tabs: WorkspacePaneTabEntry[]
      sessions: TerminalSessionSummary[]
    } & TerminalFirstFrame)
  | { ok: false; message: string }

export interface TerminalWriteInput {
  terminalRuntimeSessionId: string
  data: string
  clientId?: string
}

export interface TerminalResizeInput {
  terminalRuntimeSessionId: string
  cols: number
  rows: number
  clientId?: string
}

export type TerminalTakeoverInput = TerminalResizeInput

export interface TerminalSessionInput {
  terminalRuntimeSessionId: string
}

export interface TerminalNotifyBellInput {
  title: string
  body: string
  terminalSessionId?: string
  terminalWorktreeKey?: string
  repoRoot: string
}

export interface TerminalTestNotificationInput {
  title: string
  body: string
}

export interface TerminalListSessionsInput {
  repoRoot: string
  repoInstanceId: string
}

export interface TerminalPruneInput {
  repoRoot: string
  repoInstanceId: string
}

export interface TerminalListWorkspaceTabsInput {
  repoRoot: string
  repoInstanceId: string
}

export interface TerminalReplaceWorkspaceTabsInput extends WorkspacePaneTabsTarget, RepoInstanceRuntimeInput {
  tabs: WorkspacePaneTabEntry[]
}

export type TerminalUpdateWorkspaceTabsOperation =
  | {
      type: 'open-static'
      tabType: WorkspacePaneStaticTabType
      insertAfterIdentity?: string | null
    }
  | { type: 'close-static'; tabType: WorkspacePaneStaticTabType }
  | { type: 'reorder'; tabIdentities: string[] }

export interface TerminalUpdateWorkspaceTabsInput extends WorkspacePaneTabsTarget, RepoInstanceRuntimeInput {
  operation: TerminalUpdateWorkspaceTabsOperation
}

export interface WorkspacePaneTabsEntry extends WorkspacePaneTabsTarget {
  tabs: WorkspacePaneTabEntry[]
}

export interface TerminalSessionSummary {
  terminalRuntimeSessionId: string
  terminalSessionId: string
  repoInstanceId: string
  repoRoot: string
  branch: string
  worktreePath: string
  cwd: string
  controller: TerminalController | null
  processName: string
  canonicalTitle: string | null
  phase: TerminalSessionPhase
  message: string | null
  cols: number
  rows: number
}

export interface TerminalHydrationSnapshot {
  terminalRuntimeSessionId: string
  snapshot: string
  snapshotSeq: number
}

export type TerminalMutationResult = boolean

// All realtime events below are addressed by both `terminalRuntimeSessionId` and
// `terminalSessionId`. See the "Identity model" naming-boundary note in
// `docs/terminal.md`: `terminalRuntimeSessionId` is only a server runtime lookup id
// (it may be replaced when the runtime binding is replaced, and it is
// *not* the durable terminal-tab identity), while `terminalSessionId` is
// the durable client-facing tab identity. Clients must route realtime
// events by `terminalSessionId` first and fall back to a `terminalRuntimeSessionId`
// index only as a secondary lookup — that index is a client-local cache
// populated from attach/reconcile and is not guaranteed to be populated
// yet for a session the client has not attached to locally (e.g. a
// background tab). Do not add a realtime event that carries
// `terminalRuntimeSessionId` alone; see the dropped-title-update regression this
// pattern caused.
export interface TerminalOutputEvent {
  terminalRuntimeSessionId: string
  terminalSessionId: string
  data: string
  seq: number
  processName: string
}

// Bell is an ephemeral realtime hint for currently connected clients. It is
// intentionally not part of terminal summaries or any persisted unread model.
export interface TerminalBellRealtimeEvent {
  terminalRuntimeSessionId: string
  terminalSessionId: string
  repoRoot: string
  worktreePath: string
  processName: string
  canonicalTitle: string | null
}

export interface TerminalTitleEvent {
  terminalRuntimeSessionId: string
  terminalSessionId: string
  repoRoot: string
  worktreePath: string
  canonicalTitle: string | null
}

export interface TerminalExitEvent {
  terminalRuntimeSessionId: string
  terminalSessionId: string
}

/**
 * Realtime identity-change event (controller crash, controller
 * reconnect, sibling-tab claim, etc.). Carries the stable identity
 * fields only — no phase, no message, no title. Lifecycle travels on
 * its own dedicated `lifecycle` event so a phase update can never be
 * confused with a role update at the wire or the client's
 * `applyIdentity` boundary.
 *
 * For takeover specifically, see `TerminalTakeoverResult` — that
 * response is authoritative and carries both identity and lifecycle
 * fields in a single payload so the client can apply either
 * without re-checking the shape.
 */
export interface TerminalIdentityEvent {
  terminalRuntimeSessionId: string
  terminalSessionId: string
  controller: TerminalController | null
  canonicalCols: number
  canonicalRows: number
}

/**
 * Realtime lifecycle-change event (phase transitions, takeover-pending
 * toggles). Carries only the transient lifecycle fields — no role,
 * no controller, no geometry. The client's `applyLifecycle` boundary
 * never sees a role change, so a transitional phase (e.g. `'opening'`
 * during a pre-spawn identity broadcast) cannot trigger a
 * controller→viewer teardown decision.
 */
export interface TerminalLifecycleEvent {
  terminalRuntimeSessionId: string
  terminalSessionId: string
  phase: TerminalSessionPhase
  message: string | null
  takeoverPending: boolean
}
