import type { WorkspaceProbeState, WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'

function isConclusiveGitUnavailable(probe: WorkspaceProbeState): boolean {
  return probe.status === 'ready' && probe.capabilities.git.status === 'unavailable' && probe.diagnostics.length === 0
}

export function workspaceGitCleanupRequired(before: WorkspaceProbeState, after: WorkspaceSettledProbeState): boolean {
  return !isConclusiveGitUnavailable(before) && isConclusiveGitUnavailable(after)
}
