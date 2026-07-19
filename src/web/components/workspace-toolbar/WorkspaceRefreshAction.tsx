import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { AsyncButton } from '#/web/components/AsyncButton.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { formatTranslatableReason } from '#/web/lib/remote-diagnostics.ts'
import { useT } from '#/web/stores/i18n.ts'
import { runManualWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'

export function WorkspaceRefreshAction({ workspaceId }: { workspaceId: WorkspaceId }) {
  const t = useT()
  const workspaceRuntimeId = useWorkspacesStore((state) => state.workspaces[workspaceId]?.workspaceRuntimeId ?? null)
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefresh(): Promise<void> {
    if (!workspaceRuntimeId) return
    setRefreshing(true)
    try {
      const outcome = await runManualWorkspaceRefresh(
        { get: useWorkspacesStore.getState, set: useWorkspacesStore.setState },
        workspaceId,
        { workspaceRuntimeId },
      )
      if (!outcome.ok && !('cancelled' in outcome)) {
        toast.error(formatTranslatableReason(t, outcome.message))
      }
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Tip label={t('menu.view.refresh')}>
      <AsyncButton
        variant="ghost"
        size="icon-lg"
        disabled={!workspaceRuntimeId || refreshing}
        loading={refreshing}
        aria-label={t('menu.view.refresh')}
        onClick={handleRefresh}
      >
        <RefreshCw aria-hidden="true" />
      </AsyncButton>
    </Tip>
  )
}
