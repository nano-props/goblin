import { toast } from 'sonner'
import { rpc } from '#/renderer/rpc.ts'
import type { OpenRepoResult } from '#/renderer/stores/repos/types.ts'

interface Options {
  openRepo: (path: string) => Promise<OpenRepoResult>
  t: (key: string) => string
}

export async function openRepoFromDialog({ openRepo, t }: Options): Promise<void> {
  const path = await rpc.repo.openDialog.mutate()
  if (!path) return
  const result = await openRepo(path)
  if (!result.ok) {
    toast.error(t('drop.open-failed'), {
      description: t(result.message),
    })
  }
}
