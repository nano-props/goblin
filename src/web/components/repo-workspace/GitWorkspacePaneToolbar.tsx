import { defineComponent } from 'vue'
import type { ParsedWorkspacePaneRoute } from '#/web/app/navigation/route-model.ts'
import type {
  CurrentGitWorkspacePanePresentation,
  GitWorkspacePaneProjection,
} from '#/web/components/repo-workspace/model.ts'
import { WorkspacePaneTargetToolbar } from '#/web/components/workspace-pane/WorkspacePaneTargetToolbar.tsx'
import {
  workspacePaneFilesystemTargetForLocation,
  workspacePaneLocationForWorktree,
} from '#/web/workspace-pane/workspace-pane-location.ts'
import type { WorkspacePaneSurfaceTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  WorkspaceToolbar,
  WorkspaceToolbarLeadingSpacer,
  WorkspaceToolbarPrimary,
} from '#/web/components/workspace-toolbar-chrome.tsx'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'

interface GitWorkspacePaneToolbarProps {
  repo: GitWorkspacePaneProjection
  detail: CurrentGitWorkspacePanePresentation
  workspacePaneId: string
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  workspacePaneTabModel: WorkspacePaneTabModel
  trafficLightOffset?: boolean
  onBackToGitWorkspaceNavigator?: () => void
}

export const GitWorkspacePaneToolbar = defineComponent<GitWorkspacePaneToolbarProps>({
  name: 'GitWorkspacePaneToolbar',
  props: [
    'repo',
    'detail',
    'workspacePaneId',
    'workspacePaneRoute',
    'workspacePaneTabModel',
    'trafficLightOffset',
    'onBackToGitWorkspaceNavigator',
  ],

  setup(props) {
    const compact = useIsCompactUi()

    return () => {
      const branch = props.detail.branch
      if (!branch) {
        return (
          <WorkspaceToolbar draggable={!compact.value} trafficLightOffset={props.trafficLightOffset ?? false}>
            <WorkspaceToolbarLeadingSpacer reserve={props.trafficLightOffset ?? false} />
            <WorkspaceToolbarPrimary />
          </WorkspaceToolbar>
        )
      }
      if (props.repo.probe.status !== 'ready') return null
      const target: WorkspacePaneSurfaceTarget = props.detail.worktree
        ? workspacePaneFilesystemTargetForLocation(
            workspacePaneLocationForWorktree(props.repo.id, props.repo.workspaceRuntimeId, props.detail.worktree),
            props.repo.probe.capabilities,
          )
        : {
            kind: 'git-branch',
            workspaceId: props.repo.id,
            workspaceRuntimeId: props.repo.workspaceRuntimeId,
            branchName: branch.name,
            capabilities: props.repo.probe.capabilities,
          }

      return (
        <WorkspacePaneTargetToolbar
          target={target}
          model={props.workspacePaneTabModel}
          workspacePaneId={props.workspacePaneId}
          workspacePaneRoute={props.workspacePaneRoute}
          statusCount={props.detail.statusCount}
          trafficLightOffset={props.trafficLightOffset ?? false}
          onBackToNavigator={props.onBackToGitWorkspaceNavigator}
        />
      )
    }
  },
})
