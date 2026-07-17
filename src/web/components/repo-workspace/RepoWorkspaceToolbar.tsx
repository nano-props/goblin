import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type { BranchActions } from '#/web/hooks/useBranchActions.tsx'
import type { RepoWorkspaceTabModel } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import type { CurrentRepoWorkspacePresentation, RepoWorkspaceRepo } from '#/web/components/repo-workspace/model.ts'
import { WorkspaceOpenExternallyMenu } from '#/web/components/repo-workspace/WorkspaceOpenExternallyMenu.tsx'
import {
  WorkspacePaneTargetToolbar,
} from '#/web/components/workspace-pane/WorkspacePaneTargetToolbar.tsx'
import type { WorkspacePaneSurfaceTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  WorkspaceToolbar,
  WorkspaceToolbarLeadingSpacer,
  WorkspaceToolbarPrimary,
} from '#/web/components/workspace-toolbar-chrome.tsx'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'

interface Props {
  repo: RepoWorkspaceRepo
  detail: CurrentRepoWorkspacePresentation
  workspacePaneId: string
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
  workspacePaneTabModel: RepoWorkspaceTabModel
  trafficLightOffset?: boolean
  branchActions?: BranchActions
  onBackToBranchNavigator?: () => void
}

export function RepoWorkspaceToolbar({
  repo,
  detail,
  workspacePaneId,
  workspacePaneRoute,
  workspacePaneTabModel,
  trafficLightOffset = false,
  branchActions,
  onBackToBranchNavigator,
}: Props) {
  const compact = useIsCompactUi()
  const branch = detail.branch
  if (!branch) {
    return (
      <WorkspaceToolbar draggable={!compact} trafficLightOffset={trafficLightOffset}>
        <WorkspaceToolbarLeadingSpacer reserve={trafficLightOffset} />
        <WorkspaceToolbarPrimary />
      </WorkspaceToolbar>
    )
  }
  if (repo.workspaceProbe.status !== 'ready') return null
  const target: WorkspacePaneSurfaceTarget = branch.worktree
    ? {
        kind: 'git-worktree',
        workspaceId: repo.id,
        workspaceRuntimeId: repo.repoRuntimeId,
        branchName: branch.name,
        rootPath: branch.worktree.path,
        capabilities: repo.workspaceProbe.capabilities,
      }
    : {
        kind: 'git-branch',
        workspaceId: repo.id,
        workspaceRuntimeId: repo.repoRuntimeId,
        branchName: branch.name,
        capabilities: repo.workspaceProbe.capabilities,
      }

  return (
    <WorkspacePaneTargetToolbar
      target={target}
      model={workspacePaneTabModel}
      workspacePaneId={workspacePaneId}
      workspacePaneRoute={workspacePaneRoute}
      statusCount={detail.statusCount}
      trafficLightOffset={trafficLightOffset}
      onBackToNavigator={onBackToBranchNavigator}
      trailingActions={
        branchActions ? <WorkspaceOpenExternallyMenu repo={repo} branch={branch} branchActions={branchActions} /> : null
      }
    />
  )
}
