import { useEffect } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '#/web/components/ConfirmDialog.tsx'
import { trashWorkspaceFile } from '#/web/workspace-filesystem-client.ts'
import { useLastNonNull } from '#/web/hooks/useLastNonNull.ts'
import { useT } from '#/web/stores/i18n.ts'
import { useFiletreeActionDialogsStore } from '#/web/stores/workspaces/filetree-action-dialogs.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

interface Props {
  readonly currentWorkspaceId: WorkspaceId | null
  readonly currentWorkspaceRuntimeId: string | null
}

export function FiletreeActionDialogHost({ currentWorkspaceId, currentWorkspaceRuntimeId }: Props) {
  const t = useT()
  const trashFileConfirm = useFiletreeActionDialogsStore((s) => s.trashFileConfirm)
  const closeTrashFileConfirm = useFiletreeActionDialogsStore((s) => s.closeTrashFileConfirm)
  const closeStaleDialogs = useFiletreeActionDialogsStore((s) => s.closeStaleDialogs)
  const displayTrashFileConfirm = useLastNonNull(trashFileConfirm)

  useEffect(() => {
    closeStaleDialogs(
      currentWorkspaceId && currentWorkspaceRuntimeId
        ? { workspaceId: currentWorkspaceId, workspaceRuntimeId: currentWorkspaceRuntimeId }
        : null,
    )
  }, [currentWorkspaceId, currentWorkspaceRuntimeId, closeStaleDialogs])

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
        const result = await trashWorkspaceFile(trashFileConfirm.target, trashFileConfirm.path)
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
