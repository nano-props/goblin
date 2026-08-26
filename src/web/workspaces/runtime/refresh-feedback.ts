import { toast } from 'vue-sonner'
import { formatTranslatableReason } from '#/web/lib/remote-diagnostics.ts'
import type { WorkspaceRefreshOutcome } from '#/web/stores/workspaces/workspace-refresh-command.ts'

export function presentWorkspaceRefreshOutcome(outcome: WorkspaceRefreshOutcome, t: (key: string) => string): boolean {
  if (outcome.ok) return true
  if (outcome.kind === 'uncertain') {
    toast.warning(t(outcome.message), { id: 'workspace-refresh-outcome-uncertain' })
  } else if (outcome.kind === 'failed') {
    toast.error(formatTranslatableReason(t, outcome.message))
  }
  return false
}
