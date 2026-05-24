export interface TerminalOpenInput {
  repoRoot: string
  branch: string
  worktreePath: string
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
}

export interface TerminalExitEvent {
  sessionId: string
}
