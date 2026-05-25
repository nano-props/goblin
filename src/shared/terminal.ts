export interface TerminalOpenInput {
  repoRoot: string
  branch: string
  worktreePath: string
  terminalId: string
  cols: number
  rows: number
}

export type TerminalRestartInput = TerminalOpenInput

export type TerminalOpenResult =
  | {
      ok: true
      sessionId: string
      replay: string
      replaySeq: number
      replayTruncated: boolean
      processName: string
    }
  | { ok: false; message: string }

export interface TerminalWriteInput {
  sessionId: string
  data: string
}

export interface TerminalResizeInput {
  sessionId: string
  cols: number
  rows: number
}

export interface TerminalSessionInput {
  sessionId: string
}

export interface TerminalPruneRepoInput {
  repoRoot: string
  worktreePaths: string[]
}

export type TerminalMutationResult = boolean

export interface TerminalOutputEvent {
  sessionId: string
  data: string
  seq: number
  processName: string
}

export interface TerminalExitEvent {
  sessionId: string
}

const MIN_TERMINAL_COLS = 1
const MAX_TERMINAL_COLS = 500
const MIN_TERMINAL_ROWS = 1
const MAX_TERMINAL_ROWS = 300

export function normalizeTerminalSize(cols: unknown, rows: unknown): { cols: number; rows: number } | null {
  if (typeof cols !== 'number' || typeof rows !== 'number' || !Number.isFinite(cols) || !Number.isFinite(rows)) {
    return null
  }
  const c = Math.floor(cols)
  const r = Math.floor(rows)
  if (c < MIN_TERMINAL_COLS || c > MAX_TERMINAL_COLS || r < MIN_TERMINAL_ROWS || r > MAX_TERMINAL_ROWS) {
    return null
  }
  return { cols: c, rows: r }
}

export function isValidTerminalSize(cols: unknown, rows: unknown): boolean {
  return normalizeTerminalSize(cols, rows) !== null
}
