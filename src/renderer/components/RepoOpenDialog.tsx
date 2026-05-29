import { OpenRepositoryDialog } from '#/renderer/components/OpenRepositoryDialog.tsx'
import { useReposStore } from '#/renderer/stores/repos/store.ts'

interface RepoOpenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RepoOpenDialog({ open, onOpenChange }: RepoOpenDialogProps) {
  const openRepo = useReposStore((s) => s.openRepo)

  return <OpenRepositoryDialog open={open} onClose={() => onOpenChange(false)} onOpen={openRepo} />
}
