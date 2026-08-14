export type WorkspacePaneRuntimeUnreadyProjectionPhase = 'pending' | 'failed'
export type WorkspacePaneRuntimeProjectionPhase = WorkspacePaneRuntimeUnreadyProjectionPhase | 'ready'

export interface WorkspacePaneRuntimeProjectionState {
  phase: WorkspacePaneRuntimeProjectionPhase
  errorMessage?: string
}
