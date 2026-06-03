import { OpenRepositoryDialog } from '#/web/components/OpenRepositoryDialog.tsx'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
interface RepoOpenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RepoOpenDialog({ open, onOpenChange }: RepoOpenDialogProps) {
  const ensureWorkspaceOpen = useReposStore((s) => s.ensureWorkspaceOpen)
  const navigation = useMainWindowNavigation()

  return (
    <OpenRepositoryDialog
      open={open}
      onClose={() => onOpenChange(false)}
      onOpen={async (path) => {
        const result = await ensureWorkspaceOpen(path)
        if (result.ok) navigation.activateRepo(result.id)
        return result
      }}
    />
  )
}
