import { defineComponent } from 'vue'
import { toast } from 'vue-sonner'
import { OpenWorkspaceDialog } from '#/web/components/OpenWorkspaceDialog.tsx'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
interface WorkspaceOpenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const WorkspaceOpenDialog = defineComponent<WorkspaceOpenDialogProps>({
  name: 'WorkspaceOpenDialog',
  props: ['open', 'onOpenChange'],
  setup(props) {
    const t = useT()
    const navigation = useAppNavigation()

    return () => (
      <OpenWorkspaceDialog
        open={props.open}
        onClose={() => props.onOpenChange(false)}
        onOpen={async (path, signal) => {
          const result = await workspacesStore.getState().openWorkspaceMembership(path)
          if (signal.aborted) return result
          if (result.ok) {
            try {
              navigation.activateWorkspace(result.workspaceId)
            } catch (error) {
              const description = error instanceof Error ? error.message : t('error.unknown')
              toast.error(t('workspace-picker.open-presentation-failed'), { description })
            }
          }
          return result
        }}
      />
    )
  },
})
