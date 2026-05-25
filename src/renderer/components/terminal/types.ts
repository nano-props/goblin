import type { TerminalExitEvent, TerminalOutputEvent } from '#/shared/terminal.ts'

export type TerminalPhase = 'opening' | 'open' | 'error'

export interface TerminalDescriptor {
  key: string
  groupKey: string
  terminalId: string
  index: number
  repoRoot: string
  branch: string
  worktreePath: string
}

export interface TerminalSnapshot {
  phase: TerminalPhase
  message: string | null
  processName: string
  search?: TerminalSearchResult | null
}

export interface TerminalSearchResult {
  resultIndex: number
  resultCount: number
  found: boolean
}

export interface TerminalSessionBase {
  repoRoot: string
  branch: string
  worktreePath: string
}

export interface TerminalSessionSummary {
  key: string
  groupKey: string
  terminalId: string
  index: number
  title: string
  phase: TerminalPhase
  active: boolean
}

export interface TerminalSessionContextValue {
  version: number
  ensureDefault: (base: TerminalSessionBase) => string
  createTerminal: (base: TerminalSessionBase) => string
  activeDescriptor: (groupKey: string) => TerminalDescriptor | null
  sessionSummaries: (groupKey: string) => TerminalSessionSummary[]
  setActive: (groupKey: string, key: string) => void
  closeTerminal: (key: string) => TerminalSessionSummary[]
  attach: (descriptor: TerminalDescriptor, host: HTMLElement) => void
  detach: (key: string, host: HTMLElement) => void
  restart: (key: string) => void
  snapshot: (key: string) => TerminalSnapshot
  isTerminalFocusTarget: (key: string, target: EventTarget | null) => boolean
  findNext: (key: string, term: string, incremental?: boolean) => TerminalSearchResult
  findPrevious: (key: string, term: string) => TerminalSearchResult
  clearSearch: (key: string) => void
  /** Serializes xterm framebuffer state as VT sequences; not plain-text output for copy UI. */
  serialize: (key: string) => string
}

export interface ManagedTerminalSessionLike {
  descriptor: TerminalDescriptor
  updateDescriptor: (descriptor: TerminalDescriptor) => void
  attach: (host: HTMLElement) => void
  detach: (host: HTMLElement, parkingRoot: HTMLElement) => void
  restart: () => void
  dispose: () => void
  snapshot: () => TerminalSnapshot
  isTerminalFocusTarget: (target: EventTarget | null) => boolean
  findNext: (term: string, incremental?: boolean) => TerminalSearchResult
  findPrevious: (term: string) => TerminalSearchResult
  clearSearch: () => void
  /** Serializes xterm framebuffer state as VT sequences; not plain-text output for copy UI. */
  serialize: () => string
  handleOutput: (event: TerminalOutputEvent) => void
  handleExit: (event: TerminalExitEvent) => boolean
}
