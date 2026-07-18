import { toast } from 'sonner'
import { CloneRepositoryDialog, type CloneRepositoryRequest } from '#/web/components/CloneRepositoryDialog.tsx'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import { cloneRepository as runCloneRepository } from '#/web/repo-client.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { reportOpenRepoPostOpenEffects } from '#/web/lib/open-repo-result-feedback.ts'
import type { CloneRepoResult } from '#/shared/api-types.ts'
interface RepoCloneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RepoCloneDialog({ open, onOpenChange }: RepoCloneDialogProps) {
  const t = useT()
  const ensureWorkspaceOpen = useReposStore((s) => s.ensureWorkspaceOpen)
  const navigation = usePrimaryWindowNavigation()

  async function handleClone(request: CloneRepositoryRequest): Promise<CloneRepoResult> {
    const { signal, ...cloneInput } = request
    const result = await runCloneRepository(cloneInput, { signal })
    if (!result.ok || !result.path) return result
    const openResult = await ensureWorkspaceOpen(result.path)
    if (!openResult.ok) {
      const openErrorMessage = t(openResult.message)
      toast.error(t('drop.open-failed'), {
        description: `${result.path}\n${openErrorMessage}`,
      })
      return { ok: false, message: openResult.message, path: result.path }
    }
    navigation.activateRepo(openResult.id)
    reportOpenRepoPostOpenEffects(openResult, t, { descriptionPrefix: result.path })
    toast.success(t('workspace-picker.clone-opened'), { description: result.path })
    return result
  }

  return <CloneRepositoryDialog open={open} onClose={() => onOpenChange(false)} onClone={handleClone} />
}
