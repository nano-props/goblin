export interface WorkspacePaneTabClosePresentationEffects {
  onCommit(): void
  onAbandon(): void
}

export function createWorkspacePaneTabClosePresentationLease(
  effects: WorkspacePaneTabClosePresentationEffects | null | undefined,
): WorkspacePaneTabClosePresentationEffects | null {
  if (!effects) return null
  let settled = false
  return {
    onCommit() {
      if (settled) return
      settled = true
      effects.onCommit()
    },
    onAbandon() {
      if (settled) return
      settled = true
      effects.onAbandon()
    },
  }
}
