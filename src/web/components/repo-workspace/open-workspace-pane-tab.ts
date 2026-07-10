import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import {
  dispatchOpenWorkspacePaneStaticTabAction,
  type OpenWorkspacePaneStaticTabActionOptions,
} from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
import type { WorkspacePaneTabControllerCommitNavigation } from '#/web/workspace-pane/workspace-pane-tab-controller.ts'

export async function openWorkspacePaneTab(input: {
  repoId: string
  branchName: string
  worktreePath: string | null | undefined
  type: WorkspacePaneStaticTabType
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
  insertAfterIdentity?: string | null
  navigation: WorkspacePaneTabControllerCommitNavigation
}): Promise<boolean> {
  return await dispatchOpenWorkspacePaneStaticTabAction(input satisfies OpenWorkspacePaneStaticTabActionOptions)
}
