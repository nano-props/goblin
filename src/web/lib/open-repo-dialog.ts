import { toast } from 'sonner'
import { chooseLocalRepositoryPath, hasNativeDirectoryPicker } from '#/web/app-shell-client.ts'
import type { OpenRepoResult } from '#/web/stores/repos/types.ts'
import { reportOpenRepoPostOpenEffects } from '#/web/lib/open-repo-result-feedback.ts'
interface Options {
  ensureWorkspaceOpen: (path: string) => Promise<OpenRepoResult>
  activateRepo?: (repoId: string) => void
  openRepoPathDialog?: () => void
  t: (key: string) => string
}

export async function openRepoFromDialog({
  ensureWorkspaceOpen,
  activateRepo,
  openRepoPathDialog,
  t,
}: Options): Promise<void> {
  if (!hasNativeDirectoryPicker()) {
    openRepoPathDialog?.()
    return
  }
  const path = await chooseLocalRepositoryPath()
  if (!path) return
  const result = await ensureWorkspaceOpen(path)
  if (!result.ok) {
    toast.error(t('drop.open-failed'), {
      description: t(result.message),
    })
    return
  }
  reportOpenRepoPostOpenEffects(result, t)
  activateRepo?.(result.id)
}
