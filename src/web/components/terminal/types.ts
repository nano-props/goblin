import type {
  TerminalClientRole,
  TerminalControllerStatus,
  TerminalExitEvent,
  TerminalOutputEvent,
} from '#/shared/terminal-types.ts'
import type { TerminalInput, TerminalUserInputSource } from '#/web/components/terminal/terminal-input.ts'
export type TerminalPhase = 'opening' | 'restarting' | 'open' | 'error' | 'closed'

export interface TerminalDescriptor {
  key: string
  worktreeTerminalKey: string
  slotId: string
  index: number
  repoRoot: string
  branch: string
  worktreePath: string
}

export interface TerminalProgressState {
  /** 1 = normal, 2 = error, 3 = indeterminate, 4 = paused/warning. State 0 clears the progress (not stored). */
  state: 1 | 2 | 3 | 4
  /** 0-100 percent */
  value: number
}

export interface TerminalBellEvent {
  processName: string
  /** Server-canonical terminal title parsed from the OSC 0/2 stream. */
  canonicalTitle?: string | null
  visible: boolean
}

export interface TerminalClientOwnershipViewModel {
  role: TerminalClientRole
  controllerStatus: TerminalControllerStatus
}

export interface TerminalClientSnapshot extends TerminalClientOwnershipViewModel {
  active: boolean
  canTakeover: boolean
  canonicalCols: number | null
  canonicalRows: number | null
  phase: TerminalPhase
}

/**
 * Ownership state delivered by either the realtime `ownership` event
 * (controller crash / grace expiry / controller reconnect) or the
 * `terminal.takeover` response (now an authoritative handshake — see
 * `TerminalTakeoverResult` in `src/shared/terminal-types.ts`). Both
 * surfaces carry the same fields so the renderer can apply either
 * without re-checking the shape.
 */
export interface TerminalOwnershipViewModel extends TerminalClientOwnershipViewModel {
  ptySessionId: string
  canonicalCols: number
  canonicalRows: number
  phase: TerminalPhase
}

export interface TerminalSessionHydrationInput extends TerminalOwnershipViewModel {
  phase: TerminalPhase
  message: string | null
  processName: string
  canonicalTitle?: string | null
  snapshot: string
  snapshotSeq: number
}

export interface TerminalSnapshot {
  phase: TerminalPhase
  message: string | null
  processName: string
  /** Server-canonical terminal title from attach hydration or realtime title events. */
  canonicalTitle?: string | null
  attachment?: TerminalClientSnapshot | null
  search?: TerminalSearchResult | null
  progress?: TerminalProgressState | null
  /** True while a takeover request has been sent but ownership has not yet been confirmed. */
  takeoverPending?: boolean
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

export interface TerminalRepoSnapshot {
  instanceToken: number
  branchByWorktreePath: Record<string, string>
}

export type TerminalRepoIndex = Record<string, TerminalRepoSnapshot>

export interface TerminalSlotSummary {
  type: 'terminal'
  id: string
  key: string
  worktreeTerminalKey: string
  slotId: string
  index: number
  displayOrder: number
  title: string
  fullTitle?: string
  originalTitle?: string | null
  phase: TerminalPhase
  selected: boolean
  hasBell: boolean
}

export type WorkspacePaneViewSummary = TerminalSlotSummary

export interface WorktreeTerminalSnapshot {
  worktreeTerminalKey: string
  selectedDescriptor: TerminalDescriptor | null
  sessions: TerminalSlotSummary[]
  count: number
  bellCount: number
  pendingCreate: boolean
}

export interface TerminalSessionContextValue {
  createTerminal: (base: TerminalSessionBase) => Promise<string>
  registerHost: (worktreeTerminalKey: string, host: HTMLElement) => void
  unregisterHost: (worktreeTerminalKey: string, host: HTMLElement) => void
  selectTerminal: (worktreeTerminalKey: string, key: string) => void
  scrollToBottom: (key: string) => void
  scrollLines: (key: string, amount: number) => void
  clearBell: (key: string) => boolean
  closeTerminalByDescriptor: (key: string, base: TerminalSessionBase) => void
  attach: (descriptor: TerminalDescriptor, host: HTMLElement) => void
  detach: (key: string, host: HTMLElement) => void
  restart: (key: string) => void
  isTerminalFocusTarget: (key: string, target: EventTarget | null) => boolean
  findNext: (key: string, term: string, incremental?: boolean) => TerminalSearchResult
  findPrevious: (key: string, term: string) => TerminalSearchResult
  clearSearch: (key: string) => void
  writeInput: (key: string, data: string, source?: TerminalUserInputSource) => void
  takeover: (key: string) => Promise<boolean>
  /** Serializes xterm framebuffer state as VT sequences; not plain-text output for copy UI. */
  serialize: (key: string) => string
}

export interface TerminalSessionReadContextValue {
  worktreeSnapshot: (worktreeTerminalKey: string) => WorktreeTerminalSnapshot
  subscribeWorktree: (worktreeTerminalKey: string, listener: () => void) => () => void
  snapshot: (key: string) => TerminalSnapshot
  subscribeSnapshot: (key: string, listener: () => void) => () => void
}

export interface ManagedTerminalSessionLike {
  descriptor: TerminalDescriptor
  updateDescriptor: (descriptor: TerminalDescriptor) => void
  attach: (host: HTMLElement) => void
  detach: (host: HTMLElement, parkingRoot: HTMLElement) => void
  restart: () => void
  dispose: (options?: { closeSlot?: boolean }) => void
  snapshot: () => TerminalSnapshot
  isTerminalFocusTarget: (target: EventTarget | null) => boolean
  findNext: (term: string, incremental?: boolean) => TerminalSearchResult
  findPrevious: (term: string) => TerminalSearchResult
  clearSearch: () => void
  scrollToBottom: () => void
  scrollLines: (amount: number) => void
  writeInput: (input: TerminalInput) => void
  takeover: () => void
  handleOwnership: (event: TerminalOwnershipViewModel) => void
  /** Serializes xterm framebuffer state as VT sequences; not plain-text output for copy UI. */
  serialize: () => string
  handleOutput: (event: TerminalOutputEvent) => void
  handleServerTitle: (canonicalTitle: string | null) => void
  handleExit: (event: TerminalExitEvent) => boolean
}

export function createTerminalClientSnapshot(input: {
  role: TerminalClientRole
  controllerStatus: TerminalControllerStatus
  canonicalCols: number
  canonicalRows: number
  phase: TerminalPhase
}): TerminalClientSnapshot {
  const active = input.role === 'controller'
  return {
    role: input.role,
    controllerStatus: input.controllerStatus,
    active,
    canTakeover: !active,
    canonicalCols: input.canonicalCols || null,
    canonicalRows: input.canonicalRows || null,
    phase: input.phase,
  }
}
