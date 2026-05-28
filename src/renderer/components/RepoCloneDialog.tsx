import { toast } from 'sonner'
import { CloneRepositoryDialog, type CloneRepositoryRequest } from '#/renderer/components/CloneRepositoryDialog.tsx'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { rpc } from '#/renderer/rpc.ts'
import type { CloneRepoResult } from '#/shared/rpc.ts'

interface RepoCloneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RepoCloneDialog({ open, onOpenChange }: RepoCloneDialogProps) {
  const t = useT()
  const openRepo = useReposStore((s) => s.openRepo)

  async function handleClone(request: CloneRepositoryRequest): Promise<CloneRepoResult> {
    const result = await rpc.repo.clone.mutate(request)
    if (!result.ok || !result.path) return result
    const openResult = await openRepo(result.path)
    if (!openResult.ok) {
      toast.error(t('drop.open-failed'), {
        description: `${result.path}\n${t(openResult.message)}`,
      })
      return { ok: false, message: openResult.message, path: result.path }
    }
    toast.success(t('repo-tabs.clone-opened'), { description: result.path })
    return result
  }

  return <CloneRepositoryDialog open={open} onClose={() => onOpenChange(false)} onClone={handleClone} />
}
