export type WorkspacePaneRuntimeUnreadyProjectionPhase = 'pending' | 'failed'
export type WorkspacePaneRuntimeProjectionPhase = WorkspacePaneRuntimeUnreadyProjectionPhase | 'ready'

/**
 * Composite workspace-pane state. `inconsistent` means the independently
 * authoritative tab and runtime projections disagree after both reported a
 * settled snapshot. It is deliberately not a hydration phase: callers must
 * stop and ask the user to refresh instead of retrying either projection.
 */
export type WorkspacePaneRuntimeTabUnreadyProjectionPhase =
  | WorkspacePaneRuntimeUnreadyProjectionPhase
  | 'inconsistent'
export type WorkspacePaneRuntimeTabProjectionPhase = WorkspacePaneRuntimeTabUnreadyProjectionPhase | 'ready'

export interface WorkspacePaneRuntimeProjectionState {
  phase: WorkspacePaneRuntimeProjectionPhase
  errorMessage?: string
}
