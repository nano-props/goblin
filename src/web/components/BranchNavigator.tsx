// Persistent left branch navigator pane. ScrollArea container
// around the shared BranchView.

import { BranchView } from '#/web/components/branch-navigator/BranchView.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import type { FunctionalComponent } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

interface Props {
  repoId: WorkspaceId
  onSelectBranch?: (branch: string) => void
  currentBranchName?: string | null
}

export const BranchNavigator: FunctionalComponent<Props> = (props) => (
  <ScrollArea class="h-full min-h-0 flex-1">
    <BranchView
      repoId={props.repoId}
      onSelectBranch={props.onSelectBranch}
      currentBranchName={props.currentBranchName}
    />
  </ScrollArea>
)

BranchNavigator.props = ['repoId', 'onSelectBranch', 'currentBranchName']
