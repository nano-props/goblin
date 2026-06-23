import type { WorkspacePaneViewType } from '#/shared/workspace-pane.ts'

/**
 * `controllerStatus === 'connected'` while the controller's attachment has
 * a live socket. The server clears the controller slot on disconnect
 * (no grace), so the only transient state the renderer needs to render is
 * `connected` vs `none`.
 */
export type TerminalControllerStatus = 'connected' | 'none'
export type TerminalAttachmentRole = 'controller' | 'viewer' | 'unowned'
export type TerminalSessionPhase = 'opening' | 'restarting' | 'open' | 'error' | 'closed'

export interface TerminalResolvedOwnership {
  role: TerminalAttachmentRole
  controllerStatus: TerminalControllerStatus
}

export interface TerminalController {
  attachmentId: string
  status: Exclude<TerminalControllerStatus, 'none'>
}

export interface TerminalAttachInput {
  sessionId: string
  cols: number
  rows: number
  attachmentId?: string
}

export interface TerminalCreateInput {
  repoRoot: string
  branch: string
  worktreePath: string
  kind: 'primary' | 'additional'
  cols?: number
  rows?: number
  attachmentId?: string
}

export interface TerminalRestartInput {
  sessionId: string
  cols: number
  rows: number
  attachmentId?: string
}

/**
 * Successful `takeover` result.
 *
 * First-frame contract: takeover is the authoritative handshake for
 * the new controller's view. The renderer applies the response
 * synchronously and does not need to wait for a follow-up realtime
 * `ownership` event before painting the post-takeover frame. The
 * fields mirror `TerminalFirstFrame` minus the snapshot fields
 * (`snapshot`, `snapshotSeq`) — takeover does not return a fresh
 * snapshot because the new controller keeps the buffer the viewer
 * was already showing (no re-fetch needed).
 *
 * The realtime `ownership` event still has a real job on the
 * non-takeover ownership-change paths (controller crash, grace
 * expiry, etc.). For those paths there is no response to be
 * authoritative; the event remains the source of truth. Both
 * surfaces now carry the same fields so the renderer can apply
 * either without re-checking what shape arrived.
 */
export type TerminalTakeoverResult =
  | {
      ok: true
      sessionId: string
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
 * The renderer hydrates from these and re-replays any post-snapshot
 * events the runtime captures.
 *
 * First-frame contract: a successful `attach`/`restart` response is
 * the authoritative handshake for that session's frame state. All
 * fields are required at the type level — the server must populate
 * them on every success path, and the renderer can hydrate the UI
 * without waiting for any follow-up event. This mirrors the R0
 * first-frame atomicity contract for `create` (see
 * `docs/terminal-session-lifecycle.md` §R0).
 */
export type TerminalAttachResult =
  | {
      ok: true
      sessionId: string
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

export type TerminalCatalogAction = 'created' | 'restored' | 'reused'

/**
 * `create` carries the same first-frame fields as `attach`/`restart`
 * — the renderer must be able to paint without a follow-up snapshot
 * fetch. The shared `TerminalFirstFrame` shape below is the single
 * source of truth for the first-frame contract.
 */
export interface TerminalFirstFrame {
  sessionId: string
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

export type TerminalCatalogMutationResult =
  | ({
      ok: true
      action: TerminalCatalogAction
      key: string
      sessions: TerminalSessionSummary[]
    } & TerminalFirstFrame)
  | { ok: false; message: string }

export interface TerminalWriteInput {
  sessionId: string
  data: string
  attachmentId?: string
}

export interface TerminalResizeInput {
  sessionId: string
  cols: number
  rows: number
  attachmentId?: string
}

export type TerminalTakeoverInput = TerminalResizeInput

export interface TerminalSessionInput {
  sessionId: string
}

export interface TerminalNotifyBellInput {
  title: string
  body: string
  key?: string
  repoRoot: string
}

export interface TerminalListSessionsInput {
  repoRoot: string
}

export interface TerminalSessionSummary {
  sessionId: string
  key: string
  viewType: Extract<WorkspacePaneViewType, 'terminal'>
  viewId: string
  cwd: string
  controller: TerminalController | null
  processName: string
  canonicalTitle: string | null
  phase: TerminalSessionPhase
  message: string | null
  cols: number
  rows: number
  displayOrder: number
}

export interface TerminalSessionSnapshotInput {
  sessionId: string
}

export interface TerminalSessionSnapshot {
  sessionId: string
  snapshot: string
  snapshotSeq: number
}

export type TerminalMutationResult = boolean

export interface TerminalOutputEvent {
  sessionId: string
  data: string
  seq: number
  processName: string
}

export interface TerminalTitleEvent {
  sessionId: string
  canonicalTitle: string | null
}

export interface TerminalExitEvent {
  sessionId: string
}

/**
 * Realtime ownership-change event (controller crash, grace expiry,
 * controller reconnect, etc.). For takeover specifically, see
 * `TerminalTakeoverResult` — that response is authoritative and
 * carries the same fields so the renderer can apply either without
 * re-checking the shape.
 */
export interface TerminalOwnershipEvent {
  sessionId: string
  controller: TerminalController | null
  cols: number
  rows: number
  phase: TerminalSessionPhase
}
