import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import {
  dispatchOpenWorkspacePaneStaticTabAction,
  type OpenWorkspacePaneStaticTabActionOptions,
} from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
import type { WorkspacePaneTabControllerNavigation } from '#/web/workspace-pane/workspace-pane-tab-controller.ts'

export async function openWorkspacePaneTab(input: {
  repoId: string
  branchName: string
  worktreePath: string | null | undefined
  type: WorkspacePaneStaticTabType
  workspacePaneRoute: RepoBranchWorkspacePaneRoute | null | undefined
  insertAfterIdentity?: string | null
  navigation: WorkspacePaneTabControllerNavigation
}): Promise<boolean> {
  return await dispatchOpenWorkspacePaneStaticTabAction(input satisfies OpenWorkspacePaneStaticTabActionOptions)
}
