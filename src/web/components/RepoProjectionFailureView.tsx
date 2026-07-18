import { AlertCircle, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '#/web/components/Layout.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import { useT } from '#/web/stores/i18n.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'

export function RepoProjectionFailureView({
  repo,
  message,
  onRetry,
}: {
  repo: WorkspaceState
  message: string
  onRetry: () => void
}) {
  const t = useT()
  const navigation = usePrimaryWindowNavigation()

  async function handleClose() {
    const result = await navigation.closeWorkspace(repo.id)
    if (!result.ok) toast.error(t(result.message))
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <EmptyState
        icon={<AlertCircle size={18} />}
        title={t('lazy-restore.failed')}
        body={
          <div className="space-y-3">
            <div className="break-words">{message}</div>
            <div className="flex justify-center gap-2">
              <Button type="button" variant="default" onClick={onRetry}>
                <RefreshCw />
                {t('error.try-again')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => void handleClose()}>
                <X />
                {t('repo-unavailable.close')}
              </Button>
            </div>
          </div>
        }
      />
    </section>
  )
}
