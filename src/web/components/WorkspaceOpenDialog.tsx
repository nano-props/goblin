import { OpenWorkspaceDialog } from '#/web/components/OpenWorkspaceDialog.tsx'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
interface WorkspaceOpenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WorkspaceOpenDialog({ open, onOpenChange }: WorkspaceOpenDialogProps) {
  const ensureWorkspaceOpen = useReposStore((s) => s.ensureWorkspaceOpen)
  const navigation = usePrimaryWindowNavigation()

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
