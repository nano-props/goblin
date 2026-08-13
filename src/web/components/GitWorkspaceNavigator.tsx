// Persistent Git workspace navigator pane. ScrollArea container
// around the shared GitWorkspaceNavigatorView.

import { GitWorkspaceNavigatorView } from '#/web/components/workspace-navigator/GitWorkspaceNavigatorView.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import type { FunctionalComponent } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

interface Props {
  repoId: WorkspaceId
  onSelectBranch?: (branch: string) => void
  currentBranchName?: string | null
  currentWorktreePath?: string | null
}

export const GitWorkspaceNavigator: FunctionalComponent<Props> = (props) => (
  <ScrollArea class="h-full min-h-0 flex-1">
    <GitWorkspaceNavigatorView
      repoId={props.repoId}
      onSelectBranch={props.onSelectBranch}
      currentBranchName={props.currentBranchName}
      currentWorktreePath={props.currentWorktreePath}
    />
  </ScrollArea>
)

GitWorkspaceNavigator.props = ['repoId', 'onSelectBranch', 'currentBranchName', 'currentWorktreePath']
