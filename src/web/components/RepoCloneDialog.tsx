import { toast } from 'sonner'
import { CloneRepositoryDialog, type CloneRepositoryInput } from '#/web/components/CloneRepositoryDialog.tsx'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { cloneRepository as runCloneRepository } from '#/web/repo-client.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { reportOpenWorkspacePostOpenEffects } from '#/web/lib/open-workspace-result-feedback.ts'
import type { CloneRepoResult } from '#/shared/api-types.ts'
interface RepoCloneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RepoCloneDialog({ open, onOpenChange }: RepoCloneDialogProps) {
  const t = useT()
  const ensureWorkspaceOpen = useWorkspacesStore((s) => s.ensureWorkspaceOpen)
  const navigation = useAppNavigation()

  function reportClonedWorkspaceOpenFailure(path: string, message: string) {
    toast.error(t('drop.open-failed'), {
      description: `${path}\n${message}`,
    })
  }

  async function handleClone(input: CloneRepositoryInput, signal: AbortSignal): Promise<CloneRepoResult> {
    const result = await runCloneRepository(input, { signal })
    if (!result.ok || !result.path || signal.aborted) return result
    let openResult
    try {
      openResult = await ensureWorkspaceOpen(result.path)
    } catch (err) {
      if (signal.aborted) return result
      reportClonedWorkspaceOpenFailure(result.path, err instanceof Error ? err.message : t('error.unknown'))
      return result
    }
    if (signal.aborted) return result
    if (!openResult.ok) {
      reportClonedWorkspaceOpenFailure(result.path, t(openResult.message))
      return result
    }
    navigation.activateWorkspace(openResult.workspaceId)
    reportOpenWorkspacePostOpenEffects(openResult, t, { descriptionPrefix: result.path })
    toast.success(t('workspace-picker.clone-opened'), { description: result.path })
    return result
  }

  return <CloneRepositoryDialog open={open} onClose={() => onOpenChange(false)} onClone={handleClone} />
}
