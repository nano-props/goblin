import type { WorkspaceProbeState, WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'

export type WorkspaceGitProbeConclusion = 'available' | 'conclusive-unavailable' | 'inconclusive'

export function workspaceGitProbeConclusion(probe: WorkspaceProbeState): WorkspaceGitProbeConclusion {
  if (probe.status !== 'ready') return 'inconclusive'
  if (probe.capabilities.git.status === 'available') return 'available'
  return probe.diagnostics.some((diagnostic) => diagnostic.scope === 'git') ? 'inconclusive' : 'conclusive-unavailable'
}

export function workspaceGitCleanupRequired(before: WorkspaceProbeState, after: WorkspaceSettledProbeState): boolean {
  return (
    workspaceGitProbeConclusion(before) !== 'conclusive-unavailable' &&
    workspaceGitProbeConclusion(after) === 'conclusive-unavailable'
  )
}
