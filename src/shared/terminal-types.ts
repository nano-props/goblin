import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'

/**
 * `controllerStatus === 'connected'` while the broker reports the
 * controller client online. Disconnects and missed heartbeats make the
 * effective controller `none`; server-side controller intent is tracked
 * separately from this wire-facing status.
 */
export type TerminalControllerStatus = 'connected' | 'none'
export type TerminalClientRole = 'controller' | 'viewer' | 'unowned'
export type TerminalSessionPhase = 'opening' | 'restarting' | 'open' | 'error' | 'closed'

/** Monotonic PTY binding generation owned by the server runtime session. */
export type TerminalRuntimeGeneration = number

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
  repoRuntimeId?: string
}

export interface RepoRuntimeInput {
  repoRoot: string
  repoRuntimeId: string
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
  repoRuntimeId: string
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
 * Control-metadata contract: takeover is the authoritative handshake for
 * the new controller role/lifecycle state. The client applies the response
 * synchronously and does not need to wait for a follow-up realtime
 * `identity` event before enabling the controller view.
 * A viewer is a metadata/readonly projection, not an owner of the
 * terminal render buffer; if a view must be recreated after takeover, its
 * ordinary attach decides whether recovery needs a snapshot.
 *
 * The realtime `identity` event still has a real job on the
 * non-takeover controller-change paths (for example, controller presence
 * going offline). For those paths there is no response to be
 * authoritative; the event remains the source of truth. Both
 * surfaces now carry the same fields so the client can apply
 * either without re-checking what shape arrived.
 */
export type TerminalTakeoverResult =
  | {
      ok: true
      terminalRuntimeSessionId: string
      terminalRuntimeGeneration: TerminalRuntimeGeneration
      role: 'controller' | 'viewer' | 'unowned'
      controllerStatus: 'connected' | 'none'
      controller: TerminalController | null
      canonicalCols: number
      canonicalRows: number
      phase: TerminalSessionPhase
    }
  | { ok: false; message: string }

/** Runtime metadata sampled atomically by create/attach/restart responses. */
export interface TerminalRuntimeMetadata {
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: TerminalRuntimeGeneration
  processName: string
  canonicalTitle: string | null
  phase: TerminalSessionPhase
  message: string | null
  controller: TerminalController | null
  canonicalCols: number
  canonicalRows: number
}

/**
 * A fresh PTY has no missed history. Its output starts at sequence 1 and is
 * delivered through realtime after the attach response establishes this
 * binding. The client must not reset or replay its xterm for this frame.
 */
export interface TerminalStreamFrame {
  frame: 'stream'
  phase: 'open'
}

/**
 * An existing PTY may have history the attaching view never observed.
 * `snapshotSeq` is the exact output checkpoint represented by `snapshot`;
 * buffered realtime output through that checkpoint is discarded when the
 * response is committed, then later output continues normally.
 */
export interface TerminalSnapshotFrame {
  frame: 'snapshot'
  snapshot: string
  snapshotSeq: number
  outputEra: number
}

/**
 * Attach chooses its frame protocol from server-owned PTY history:
 * a prepared session with no PTY starts as `stream`, while an already-bound
 * session attaches as `snapshot`. This distinction prevents fresh terminal
 * startup from being represented as a recovery replay.
 */
export type TerminalAttachResult =
  | ({ ok: true } & TerminalRuntimeMetadata & TerminalStreamFrame)
  | ({ ok: true } & TerminalRuntimeMetadata & TerminalSnapshotFrame)
  | { ok: false; message: string }

/** Restart always replaces an existing binding and commits a reset snapshot. */
export type TerminalRestartResult =
  ({ ok: true } & TerminalRuntimeMetadata & TerminalSnapshotFrame) | { ok: false; message: string }

export type TerminalCreateAction = 'created' | 'restored' | 'reused'

export type TerminalCreateResult =
  | ({
      ok: true
      action: TerminalCreateAction
      /** Canonical branch label resolved at the admission commit boundary. */
      branch: string
      terminalSessionId: string
      /** Exact terminal projection revision sampled with this metadata. */
      terminalSessionsRevision: number
    } & TerminalRuntimeMetadata)
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
  repoRuntimeId: string
}

export interface TerminalPruneInput {
  repoRoot: string
  repoRuntimeId: string
}

export interface TerminalSessionSummary {
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: TerminalRuntimeGeneration
  terminalSessionId: string
  repoRuntimeId: string
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

/**
 * Versioned full terminal projection for one user/repo-runtime scope.
 *
 * This revision belongs exclusively to the terminal projection. Workspace
 * pane tab revisions must never be used to decide whether this collection is
 * fresh: the two projections have independent mutation and delivery order.
 */
export interface TerminalSessionsSnapshot {
  revision: number
  sessions: TerminalSessionSummary[]
}

export type TerminalMutationResult = boolean

/**
 * Result of handing terminal input to the currently bound PTY runtime.
 * `accepted` means the runtime write call returned normally; it does not
 * claim that the shell consumed or executed the input.
 */
export type TerminalWriteResult = { status: 'accepted' } | { status: 'rejected' } | { status: 'indeterminate' }

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
  terminalRuntimeGeneration: TerminalRuntimeGeneration
  terminalSessionId: string
  data: string
  outputEra: number
  seq: number
  processName: string
}

// Bell is an ephemeral realtime hint for currently connected clients. It is
// intentionally not part of terminal summaries or any persisted unread model.
export interface TerminalBellRealtimeEvent {
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: TerminalRuntimeGeneration
  terminalSessionId: string
  repoRoot: string
  worktreePath: string
  processName: string
  canonicalTitle: string | null
}

export interface TerminalTitleEvent {
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: TerminalRuntimeGeneration
  terminalSessionId: string
  repoRoot: string
  worktreePath: string
  canonicalTitle: string | null
}

export interface TerminalExitEvent {
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: TerminalRuntimeGeneration
  terminalSessionId: string
  repoRoot: string
  repoRuntimeId: string
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
  terminalRuntimeGeneration: TerminalRuntimeGeneration
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
  terminalRuntimeGeneration: TerminalRuntimeGeneration
  terminalSessionId: string
  phase: TerminalSessionPhase
  message: string | null
  takeoverPending: boolean
}
