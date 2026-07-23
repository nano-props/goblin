import type {
  TerminalClientRole,
  TerminalControllerStatus,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalSessionBase,
  TerminalSessionPhase,
  TerminalSize,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabPlacement } from '#/shared/workspace-pane-runtime.ts'
import type { TerminalCreateAdmissionResult } from '#/web/components/terminal/terminal-create-admission.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

type TerminalDescriptorIdentity = {
  terminalSessionId: string
  index: number
}

type TerminalDescriptorFor<Session extends TerminalSessionBase> = Session extends TerminalSessionBase
  ? Session & TerminalDescriptorIdentity
  : never

export type TerminalDescriptor = TerminalDescriptorFor<TerminalSessionBase>

export interface TerminalProgressState {
  /** 1 = normal, 2 = error, 3 = indeterminate, 4 = paused/warning. State 0 clears the progress (not stored). */
  state: 1 | 2 | 3 | 4
  /** 0-100 percent */
  value: number
}

export interface TerminalBellPolicyEvent {
  processName: string
  /** Server-canonical terminal title parsed from the OSC 0/2 stream. */
  canonicalTitle?: string | null
  visible: boolean
}

export interface TerminalControllerViewModel {
  role: TerminalClientRole
  controllerStatus: TerminalControllerStatus
}

export interface TerminalAttachmentSnapshot {
  role: TerminalClientRole
}

/**
 * Identity view-model: the stable controller + geometry fields the
 * client needs to decide who controls the PTY and at what size.
 * No `phase` — phase lives on the lifecycle channel so a transitional
 * phase update can never be confused with a role change at the
 * client's `applyIdentity` boundary.
 */
export interface TerminalIdentityViewModel extends TerminalControllerViewModel {
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: number
  canonicalSize: TerminalSize
}

// Wire-level identity event: the routing-only `terminalSessionId` layered
// on top of the session-scoped `TerminalIdentityViewModel`. Kept separate
// from the base view model because `TerminalSessionRuntime`/
// `TerminalSessionState` are already scoped to one session and have no
// notion of `terminalSessionId` — only `TerminalSessionProjection`
// (which fans realtime events out across sessions) needs it to route
// reliably. See the naming-boundary note in `#/shared/terminal-types.ts`.
export interface TerminalIdentityRealtimeEvent extends TerminalIdentityViewModel {
  terminalSessionId: string
}

/**
 * Lifecycle view-model: the transient phase + message. No role — role lives on the identity
 * channel so the teardown decision can never be triggered by a
 * transitional phase update alone.
 */
export interface TerminalLifecycleViewModel {
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: number
  phase: TerminalSessionPhase
  message: string | null
}

// Wire-level lifecycle event — see `TerminalIdentityRealtimeEvent` above
// for why `terminalSessionId` is layered on separately from the
// session-scoped view model instead of added to it directly.
export interface TerminalLifecycleRealtimeEvent extends TerminalLifecycleViewModel {
  terminalSessionId: string
}

export interface TerminalSessionHydrationInput extends Omit<TerminalIdentityViewModel, 'canonicalSize'> {
  canonicalSize: TerminalSize | null
  phase: TerminalSessionPhase
  message: string | null
  processName: string
  canonicalTitle?: string | null
}

export interface TerminalFocusRequest {
  isCurrent: () => boolean
  onSettled?: () => void
}

/** A narrow input capability bound to one presented runtime generation. */
export type TerminalInputWriter = (data: string) => void

export interface TerminalSnapshot {
  phase: TerminalSessionPhase
  message: string | null
  processName: string
  /** Server-canonical terminal title from attach hydration or realtime title events. */
  canonicalTitle?: string | null
  attachment?: TerminalAttachmentSnapshot | null
  search?: TerminalSearchResult | null
  progress?: TerminalProgressState | null
  /** True while a takeover request has been sent but control has not yet been confirmed. */
  takeoverPending?: boolean
}

export interface TerminalSearchResult {
  resultIndex: number
  resultCount: number
  found: boolean
}

export interface TerminalCreateOptions {
  /**
   * Shell text to run as the terminal starts, before returning to an interactive shell.
   * The server stores this on the prepared logical session and starts the PTY only
   * after the mounted xterm reports its fitted geometry.
   *
   * Create dedupe treats requests as the same only when this command matches exactly.
   * If future create options affect the launched session, update the dedupe predicate too.
   */
  startupShellCommand?: string
  /**
   * Lazily resolves startupShellCommand after the create request has entered
   * the projection queue. Use this when preparing the command needs async work:
   * createPending must be projection-owned before that work starts, otherwise
   * workspace-pane navigation can race the eventual create result.
   */
  resolveStartupShellCommand?: () => Promise<string>
}

export interface TerminalRuntimeMembership {
  workspaceRuntimeId: string
}

export type TerminalRuntimeMembershipIndex = ReadonlyMap<WorkspaceId, TerminalRuntimeMembership>

export interface TerminalSessionSummary {
  type: 'terminal'
  terminalFilesystemTargetKey: string
  terminalSessionId: string
  index: number
  title: string
  fullTitle?: string
  originalTitle?: string | null
  processName?: string
  phase: TerminalSessionPhase
  selected: boolean
  hasBell: boolean
  hasRecentOutput: boolean
}

export interface TerminalFilesystemTargetSnapshot {
  terminalFilesystemTargetKey: string
  selectedDescriptor: TerminalDescriptor | null
  sessions: TerminalSessionSummary[]
  count: number
  bellCount: number
  outputActiveCount: number
  createPending: boolean
}

export interface TerminalSessionContextValue {
  createTerminal: (base: TerminalSessionBase, options?: TerminalCreateOptions) => Promise<string>
  createTerminalWithAdmission: (
    base: TerminalSessionBase,
    options?: TerminalCreateOptions,
    placement?: WorkspacePaneRuntimeTabPlacement,
  ) => Promise<TerminalCreateAdmissionResult>
  selectTerminal: (terminalFilesystemTargetKey: string, terminalSessionId: string) => void
  scrollToBottom: (terminalSessionId: string) => void
  scrollLines: (terminalSessionId: string, amount: number) => void
  clearBell: (terminalSessionId: string) => boolean
  closeTerminalByDescriptor: (terminalSessionId: string, base: TerminalSessionBase) => Promise<boolean>
  attach: (descriptor: TerminalDescriptor, host: HTMLElement) => void
  detach: (terminalSessionId: string, host: HTMLElement) => void
  restart: (terminalSessionId: string) => void
  /** Returns whether the session exists and accepted the focus request. */
  focusTerminal: (terminalSessionId: string, request?: TerminalFocusRequest) => boolean
  findNext: (terminalSessionId: string, term: string, incremental?: boolean) => TerminalSearchResult
  findPrevious: (terminalSessionId: string, term: string) => TerminalSearchResult
  clearSearch: (terminalSessionId: string) => void
  captureInputWriter: (terminalSessionId: string) => TerminalInputWriter | null
  takeover: (terminalSessionId: string) => Promise<boolean>
}

export interface TerminalSessionReadContextValue {
  terminalFilesystemTargetSnapshot: (terminalFilesystemTargetKey: string) => TerminalFilesystemTargetSnapshot
  subscribeTerminalFilesystemTarget: (terminalFilesystemTargetKey: string, listener: () => void) => () => void
  workspaceBellCount: (workspaceId: WorkspaceId) => number
  subscribeWorkspaceBellCount: (workspaceId: WorkspaceId, listener: () => void) => () => void
  snapshot: (terminalSessionId: string) => TerminalSnapshot
  subscribeSnapshot: (terminalSessionId: string, listener: () => void) => () => void
}
