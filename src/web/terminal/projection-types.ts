import type {
  TerminalClientRole,
  TerminalControllerStatus,
  TerminalSessionPhase,
  TerminalSize,
} from '#/shared/terminal-types.ts'

export interface TerminalControllerViewModel {
  role: TerminalClientRole
  controllerStatus: TerminalControllerStatus
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
  identityRevision: number
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
