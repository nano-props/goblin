import { toast } from 'sonner'
import { formatTranslatableReason } from '#/web/lib/remote-diagnostics.ts'
import type { ManualWorkspaceRefreshOutcome } from '#/web/stores/workspaces/workspace-refresh-command.ts'

export function presentWorkspaceRefreshOutcome(
  outcome: ManualWorkspaceRefreshOutcome,
  t: (key: string) => string,
): boolean {
  if (outcome.ok) return true
  if (!('cancelled' in outcome)) toast.error(formatTranslatableReason(t, outcome.message))
  return false
}
