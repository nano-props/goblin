import type { WorkspaceProbeState, WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'

export type WorkspaceGitProbeConclusion = 'available' | 'conclusive-unavailable' | 'inconclusive'
export type WorkspaceGitCapabilityTransition = 'promotion' | 'removal'

export function workspaceGitProbeConclusion(probe: WorkspaceProbeState): WorkspaceGitProbeConclusion {
  if (probe.status !== 'ready') return 'inconclusive'
  if (probe.capabilities.git.status === 'available') return 'available'
  return probe.diagnostics.some((diagnostic) => diagnostic.scope === 'git') ? 'inconclusive' : 'conclusive-unavailable'
}

export function workspaceGitCapabilityTransition(
  before: WorkspaceProbeState,
  after: WorkspaceSettledProbeState,
): WorkspaceGitCapabilityTransition | null {
  const beforeConclusion = workspaceGitProbeConclusion(before)
  const afterConclusion = workspaceGitProbeConclusion(after)
  if (afterConclusion === 'available' && beforeConclusion !== 'available') return 'promotion'
  if (afterConclusion === 'conclusive-unavailable' && beforeConclusion !== 'conclusive-unavailable') return 'removal'
  return null
}
