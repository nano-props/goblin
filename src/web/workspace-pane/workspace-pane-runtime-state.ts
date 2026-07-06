export type WorkspacePaneRuntimeProjectionPhase = 'pending' | 'ready' | 'failed'

export interface WorkspacePaneRuntimeProjectionState {
  phase: WorkspacePaneRuntimeProjectionPhase
  errorMessage?: string
}
