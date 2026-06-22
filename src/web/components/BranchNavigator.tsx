// Persistent left branch navigator pane. ScrollArea container
// around the shared BranchView.

import { BranchView } from '#/web/components/branch-navigator/BranchView.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'

interface Props {
  repoId: string
  showActions?: boolean
}

export function BranchNavigator({ repoId, showActions = true }: Props) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <BranchView repoId={repoId} showActions={showActions} />
    </ScrollArea>
  )
}