import { OpenWorkspaceDialog } from '#/web/components/OpenWorkspaceDialog.tsx'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
interface WorkspaceOpenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WorkspaceOpenDialog({ open, onOpenChange }: WorkspaceOpenDialogProps) {
  const ensureWorkspaceOpen = useWorkspacesStore((s) => s.ensureWorkspaceOpen)
  const navigation = useAppNavigation()

  return (
    <OpenWorkspaceDialog
      open={open}
      onClose={() => onOpenChange(false)}
      onOpen={async (path) => {
        const result = await ensureWorkspaceOpen(path)
        if (result.ok) navigation.activateWorkspace(result.workspaceId)
        return result
      }}
    />
  )
}
