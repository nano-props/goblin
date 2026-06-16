export type TerminalControllerStatus = 'connected' | 'grace' | 'none'
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

export type TerminalTakeoverResult =
  | {
      ok: true
      sessionId: string
      controller: TerminalController | null
    }
  | { ok: false; message: string }

/**
 * Successful attach/restart result.
 *
 * `snapshot`/`snapshotSeq` are the session's server-side render buffer
 * and its monotonic sequence number. The renderer hydrates from these
 * and re-replays any post-snapshot events the runtime captures.
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
      canonicalCols?: number
      canonicalRows?: number
    }
  | { ok: false; message: string }

export type TerminalCatalogAction = 'created' | 'restored' | 'reused'

export type TerminalCatalogMutationResult =
  | {
      ok: true
      action: TerminalCatalogAction
      key: string
      sessions: TerminalSessionSummary[]
    }
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

export interface TerminalReorderInput {
  repoRoot: string
  worktreePath: string
  orderedKeys: string[]
}

export interface TerminalSessionSummary {
  sessionId: string
  key: string
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

export interface TerminalOwnershipEvent {
  sessionId: string
  controller: TerminalController | null
  cols: number
  rows: number
}
