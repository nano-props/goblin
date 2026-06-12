import { toast } from 'sonner'
import { CloneRepositoryDialog, type CloneRepositoryRequest } from '#/web/components/CloneRepositoryDialog.tsx'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import { cloneRepository as runCloneRepository } from '#/web/repo-client.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { CloneRepoResult } from '#/shared/api-types.ts'
interface RepoCloneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RepoCloneDialog({ open, onOpenChange }: RepoCloneDialogProps) {
  const t = useT()
  const ensureWorkspaceOpen = useReposStore((s) => s.ensureWorkspaceOpen)
  const navigation = useMainWindowNavigation()

  async function handleClone(request: CloneRepositoryRequest): Promise<CloneRepoResult> {
    const result = await runCloneRepository(request)
    if (!result.ok || !result.path) return result
    const openResult = await ensureWorkspaceOpen(result.path)
    if (!openResult.ok) {
      toast.error(t('drop.open-failed'), {
        description: `${result.path}\n${t(openResult.message)}`,
      })
      return { ok: false, message: openResult.message, path: result.path }
    }
    navigation.activateRepo(openResult.id)
    toast.success(t('repo-tabs.clone-opened'), { description: result.path })
    return result
  }

  return <CloneRepositoryDialog open={open} onClose={() => onOpenChange(false)} onClone={handleClone} />
}
