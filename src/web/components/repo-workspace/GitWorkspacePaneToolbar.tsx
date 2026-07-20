import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import type {
  CurrentGitWorkspacePanePresentation,
  GitWorkspacePaneProjection,
} from '#/web/components/repo-workspace/model.ts'
import { WorkspacePaneTargetToolbar } from '#/web/components/workspace-pane/WorkspacePaneTargetToolbar.tsx'
import {
  gitWorktreePaneFilesystemTarget,
  type WorkspacePaneSurfaceTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { gitHead } from '#/shared/git-head.ts'
import {
  WorkspaceToolbar,
  WorkspaceToolbarLeadingSpacer,
  WorkspaceToolbarPrimary,
} from '#/web/components/workspace-toolbar-chrome.tsx'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'

interface Props {
  repo: GitWorkspacePaneProjection
  detail: CurrentGitWorkspacePanePresentation
  workspacePaneId: string
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  workspacePaneTabModel: WorkspacePaneTabModel
  trafficLightOffset?: boolean
  onBackToBranchNavigator?: () => void
}

export function GitWorkspacePaneToolbar({
  repo,
  detail,
  workspacePaneId,
  workspacePaneRoute,
  workspacePaneTabModel,
  trafficLightOffset = false,
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
  if (repo.probe.status !== 'ready') return null
  const target: WorkspacePaneSurfaceTarget = branch.worktree
    ? gitWorktreePaneFilesystemTarget({
        workspaceId: repo.id,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        head: gitHead(branch.name),
        worktreePath: branch.worktree.path,
        capabilities: repo.probe.capabilities,
      })
    : {
        kind: 'git-branch',
        workspaceId: repo.id,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        branchName: branch.name,
        capabilities: repo.probe.capabilities,
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
    />
  )
}
