import { useEffect } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '#/web/components/ConfirmDialog.tsx'
import { trashRepositoryFile } from '#/web/filetree-client.ts'
import { useLastNonNull } from '#/web/hooks/useLastNonNull.ts'
import { useT } from '#/web/stores/i18n.ts'
import { useFiletreeActionDialogsStore } from '#/web/stores/repos/filetree-action-dialogs.ts'

interface Props {
  readonly currentRepoId: string | null
}

export function FiletreeActionDialogHost({ currentRepoId }: Props) {
  const t = useT()
  const trashFileConfirm = useFiletreeActionDialogsStore((s) => s.trashFileConfirm)
  const closeTrashFileConfirm = useFiletreeActionDialogsStore((s) => s.closeTrashFileConfirm)
  const closeStaleDialogs = useFiletreeActionDialogsStore((s) => s.closeStaleDialogs)
  const displayTrashFileConfirm = useLastNonNull(trashFileConfirm)

  useEffect(() => {
    closeStaleDialogs(currentRepoId ?? '')
  }, [currentRepoId, closeStaleDialogs])

  return (
    <ConfirmDialog
      open={trashFileConfirm !== null}
      title={t('filetree.confirm-trash-title')}
      message={
        displayTrashFileConfirm ? (
          <FiletreeTrashConfirmBody body={t('filetree.confirm-trash-body')} path={displayTrashFileConfirm.path} />
        ) : (
          ''
        )
      }
      confirmLabel={t('filetree.confirm-trash-confirm')}
      destructive
      onCancel={closeTrashFileConfirm}
      onConfirm={async () => {
        if (!trashFileConfirm) return
        const result = await trashRepositoryFile(
          trashFileConfirm.repoId,
          trashFileConfirm.repoRuntimeId,
          trashFileConfirm.worktreePath,
          trashFileConfirm.path,
        )
        if (result.ok) {
          closeTrashFileConfirm()
          return
        }
        toast.error(t(result.message || 'error.failed-trash-file'))
      }}
    />
  )
}

function FiletreeTrashConfirmBody({ body, path }: { readonly body: string; readonly path: string }) {
  return (
    <div className="space-y-1">
      <span>{body}</span>
      <span className="block break-all font-mono text-foreground" title={path}>
        {path}
      </span>
    </div>
  )
}
