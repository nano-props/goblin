import type { WorkspacePaneViewType } from '#/shared/workspace-pane.ts'

/**
 * `controllerStatus === 'connected'` while the controller's client has
 * a live socket. The server clears the controller slot on disconnect
 * (no grace), so the only transient state the renderer needs to render is
 * `connected` vs `none`.
 */
export type TerminalControllerStatus = 'connected' | 'none'
export type TerminalClientRole = 'controller' | 'viewer' | 'unowned'
export type TerminalSlotPhase = 'opening' | 'restarting' | 'open' | 'error' | 'closed'

export interface TerminalResolvedOwnership {
  role: TerminalClientRole
  controllerStatus: TerminalControllerStatus
}

export interface TerminalController {
  clientId: string
  status: Exclude<TerminalControllerStatus, 'none'>
}

export interface TerminalAttachInput {
  ptySessionId: string
  cols: number
  rows: number
  clientId?: string
}

export interface TerminalCreateInput {
  repoRoot: string
  branch: string
  worktreePath: string
  kind: 'primary' | 'additional'
  cols?: number
  rows?: number
  clientId?: string
}

export interface TerminalRestartInput {
  ptySessionId: string
  cols: number
  rows: number
  clientId?: string
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
      ptySessionId: string
      role: 'controller' | 'viewer' | 'unowned'
      controllerStatus: 'connected' | 'none'
      controller: TerminalController | null
      canonicalCols: number
      canonicalRows: number
      phase: TerminalSlotPhase
    }
  | { ok: false; message: string }

/**
 * Successful attach/restart result.
 *
 * `snapshot`/`snapshotSeq` are the slot's server-side serialized
 * xterm screen and the last PTY output sequence included in that screen.
 * The renderer hydrates from these and re-replays any post-snapshot
 * events the runtime captures.
 *
 * First-frame contract: a successful `attach`/`restart` response is
 * the authoritative handshake for that slot's frame state. All
 * fields are required at the type level — the server must populate
 * them on every success path, and the renderer can hydrate the UI
 * without waiting for any follow-up event. This mirrors the R0
 * first-frame atomicity contract for `create` (see
 * `docs/terminal-slot-lifecycle.md` §R0).
 */
export type TerminalAttachResult =
  | {
      ok: true
      ptySessionId: string
      processName: string
      canonicalTitle: string | null
      phase: TerminalSlotPhase
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
  ptySessionId: string
  processName: string
  canonicalTitle: string | null
  phase: TerminalSlotPhase
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
      sessions: TerminalSlotSummary[]
    } & TerminalFirstFrame)
  | { ok: false; message: string }

export interface TerminalWriteInput {
  ptySessionId: string
  data: string
  clientId?: string
}

export interface TerminalResizeInput {
  ptySessionId: string
  cols: number
  rows: number
  clientId?: string
}

export type TerminalTakeoverInput = TerminalResizeInput

export interface TerminalSlotInput {
  ptySessionId: string
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

export interface TerminalSlotSummary {
  ptySessionId: string
  key: string
  viewType: Extract<WorkspacePaneViewType, 'terminal'>
  viewId: string
  cwd: string
  controller: TerminalController | null
  processName: string
  canonicalTitle: string | null
  phase: TerminalSlotPhase
  message: string | null
  cols: number
  rows: number
  displayOrder: number
}

export interface TerminalSlotSnapshotInput {
  ptySessionId: string
}

export interface TerminalSlotSnapshot {
  ptySessionId: string
  snapshot: string
  snapshotSeq: number
}

export type TerminalMutationResult = boolean

export interface TerminalOutputEvent {
  ptySessionId: string
  data: string
  seq: number
  processName: string
}

export interface TerminalTitleEvent {
  ptySessionId: string
  canonicalTitle: string | null
}

export interface TerminalExitEvent {
  ptySessionId: string
}

/**
 * Realtime ownership-change event (controller crash, grace expiry,
 * controller reconnect, etc.). For takeover specifically, see
 * `TerminalTakeoverResult` — that response is authoritative and
 * carries the same fields so the renderer can apply either without
 * re-checking the shape.
 */
export interface TerminalOwnershipEvent {
  ptySessionId: string
  controller: TerminalController | null
  cols: number
  rows: number
  phase: TerminalSlotPhase
}
