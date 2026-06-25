// Persistent left branch navigator pane. ScrollArea container
// around the shared BranchView.

import { BranchView } from '#/web/components/branch-navigator/BranchView.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'

interface Props {
  repoId: string
}

export function BranchNavigator({ repoId }: Props) {
  return (
    <ScrollArea className="h-full min-h-0 flex-1">
      <BranchView repoId={repoId} />
    </ScrollArea>
  )
}
