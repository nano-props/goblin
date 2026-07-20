// Persistent left branch navigator pane. ScrollArea container
// around the shared BranchView.

import { BranchView } from '#/web/components/branch-navigator/BranchView.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

interface Props {
  repoId: WorkspaceId
  onSelectBranch?: (branch: string) => void
  currentBranchName?: string | null
}

export function BranchNavigator({ repoId, onSelectBranch, currentBranchName }: Props) {
  return (
    <ScrollArea className="h-full min-h-0 flex-1">
      <BranchView repoId={repoId} onSelectBranch={onSelectBranch} currentBranchName={currentBranchName} />
    </ScrollArea>
  )
}
