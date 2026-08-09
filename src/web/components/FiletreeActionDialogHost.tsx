import { defineComponent, watch } from 'vue'
import type { FunctionalComponent } from 'vue'
import { toast } from 'vue-sonner'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { ConfirmDialog } from '#/web/components/ConfirmDialog.tsx'
import { useLastNonNull } from '#/web/hooks/useLastNonNull.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { filetreeActionDialogsStore } from '#/web/stores/workspaces/filetree-action-dialogs.ts'
import { trashWorkspaceFile } from '#/web/workspace-filesystem-client.ts'

interface Props {
  readonly currentWorkspaceId: WorkspaceId | null
  readonly currentWorkspaceRuntimeId: string | null
}

export const FiletreeActionDialogHost = defineComponent<Props>({
  name: 'FiletreeActionDialogHost',
  props: ['currentWorkspaceId', 'currentWorkspaceRuntimeId'],

  setup(props) {
    const t = useT()
    const trashFileConfirm = useStoreSelector(filetreeActionDialogsStore, (state) => state.trashFileConfirm)
    const displayTrashFileConfirm = useLastNonNull(trashFileConfirm)
    const { closeTrashFileConfirm, closeStaleDialogs } = filetreeActionDialogsStore.getState()

    // Dialog authority is scoped to a runtime identity. Route replacement must
    // close a payload that can no longer be confirmed safely.
    watch(
      [() => props.currentWorkspaceId, () => props.currentWorkspaceRuntimeId],
      ([workspaceId, workspaceRuntimeId]) => {
        closeStaleDialogs(workspaceId && workspaceRuntimeId ? { workspaceId, workspaceRuntimeId } : null)
      },
      { immediate: true },
    )

    return () => (
      <ConfirmDialog
        open={trashFileConfirm.value !== null}
        title={t('filetree.confirm-trash-title')}
        message={
          displayTrashFileConfirm.value ? (
            <FiletreeTrashConfirmBody
              body={t('filetree.confirm-trash-body')}
              path={displayTrashFileConfirm.value.path}
            />
          ) : (
            ''
          )
        }
        confirmLabel={t('filetree.confirm-trash-confirm')}
        destructive
        onCancel={closeTrashFileConfirm}
        onConfirm={async () => {
          const payload = trashFileConfirm.value
          if (!payload) return
          const result = await trashWorkspaceFile(payload.target, payload.path)
          if (result.ok) {
            closeTrashFileConfirm()
            return
          }
          const errorMessageKey = result.message || 'error.failed-trash-file'
          toast.error(t(errorMessageKey))
        }}
      />
    )
  },
})

const FiletreeTrashConfirmBody: FunctionalComponent<{ body: string; path: string }> = (props) => (
  <div class="space-y-1">
    <span>{props.body}</span>
    <span class="block break-all font-mono text-foreground" title={props.path}>
      {props.path}
    </span>
  </div>
)

FiletreeTrashConfirmBody.props = ['body', 'path']
