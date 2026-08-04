import { toast } from 'sonner'
import { OpenWorkspaceDialog } from '#/web/components/OpenWorkspaceDialog.tsx'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n.ts'
interface WorkspaceOpenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WorkspaceOpenDialog({ open, onOpenChange }: WorkspaceOpenDialogProps) {
  const t = useT()
  const ensureWorkspaceOpen = useWorkspacesStore((s) => s.ensureWorkspaceOpen)
  const navigation = useAppNavigation()

  return (
    <OpenWorkspaceDialog
      open={open}
      onClose={() => onOpenChange(false)}
      onOpen={async (path, signal) => {
        const result = await ensureWorkspaceOpen(path)
        if (signal.aborted) return result
        if (result.ok) {
          try {
            navigation.activateWorkspace(result.workspaceId)
          } catch (err) {
            const description = err instanceof Error ? err.message : t('error.unknown')
            toast.error(t('workspace-picker.open-presentation-failed'), { description })
          }
        }
        return result
      }}
    />
  )
}
