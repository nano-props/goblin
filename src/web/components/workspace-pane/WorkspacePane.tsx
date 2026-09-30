import { computed, defineComponent, useId } from 'vue'
import type { FunctionalComponent } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { WorkspacePaneSkeleton } from '#/web/components/Skeleton.tsx'
import { GitWorkspacePane } from '#/web/components/workspace-pane/GitWorkspacePane.tsx'
import { GitWorktreePane } from '#/web/components/workspace-pane/GitWorktreePane.tsx'
import { WorkspaceRootPane } from '#/web/components/workspace-pane/WorkspaceRootPane.tsx'
import type {
  GitWorkspacePaneShell,
  WorkspacePaneRouteContext,
} from '#/web/components/workspace-pane/workspace-pane-types.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspaceCapabilityState, WorkspaceState } from '#/web/stores/workspaces/types.ts'

interface WorkspacePaneProps {
  workspaceId: WorkspaceId
  currentBranchName?: string | null
  workspacePaneRouteContext: WorkspacePaneRouteContext
  shortcutsEnabled?: boolean
  toolbarNavigationOffset?: boolean
  onBackToGitWorkspaceNavigator?: () => void
}

interface WorkspacePaneShell {
  id: WorkspaceState['id']
  workspaceRuntimeId: string
  ui: Pick<WorkspaceState['ui'], 'preferredWorkspacePaneTabByTarget'> & { currentBranchName: string | null }
  capability: WorkspaceCapabilityState
  admission: WorkspaceState['admission']
}

export const WorkspacePane = defineComponent<WorkspacePaneProps>({
  name: 'WorkspacePane',
  props: [
    'workspaceId',
    'currentBranchName',
    'workspacePaneRouteContext',
    'shortcutsEnabled',
    'toolbarNavigationOffset',
    'onBackToGitWorkspaceNavigator',
  ],

  setup(props) {
    const workspacePaneId = useId()
    const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
    const workspaceShell = computed<WorkspacePaneShell | undefined>(() => {
      const workspace = workspaces.value[props.workspaceId]
      if (!workspace) return undefined
      return {
        id: workspace.id,
        workspaceRuntimeId: workspace.workspaceRuntimeId,
        ui: {
          currentBranchName: props.currentBranchName ?? null,
          preferredWorkspacePaneTabByTarget: workspace.ui.preferredWorkspacePaneTabByTarget,
        },
        capability: workspace.capability,
        admission: workspace.admission,
      }
    })

    return () =>
      workspaceShell.value ? (
        <WorkspacePaneLoaded
          workspaceShell={workspaceShell.value}
          workspacePaneRouteContext={props.workspacePaneRouteContext}
          workspacePaneId={workspacePaneId}
          shortcutsEnabled={props.shortcutsEnabled ?? true}
          toolbarNavigationOffset={props.toolbarNavigationOffset ?? false}
          onBackToGitWorkspaceNavigator={props.onBackToGitWorkspaceNavigator}
        />
      ) : null
  },
})

interface WorkspacePaneLoadedProps {
  workspaceShell: WorkspacePaneShell
  workspacePaneRouteContext: WorkspacePaneRouteContext
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarNavigationOffset: boolean
  onBackToGitWorkspaceNavigator?: () => void
}

const WorkspacePaneLoaded: FunctionalComponent<WorkspacePaneLoadedProps> = (props) => {
  if (props.workspaceShell.capability.kind === 'probing' || props.workspaceShell.capability.kind === 'unavailable') {
    return <WorkspacePaneSkeleton toolbarNavigationOffset={props.toolbarNavigationOffset} />
  }
  if (props.workspacePaneRouteContext.kind === 'git-worktree' && props.workspaceShell.capability.kind === 'git') {
    const repo = gitWorkspacePaneShell(props.workspaceShell, props.workspaceShell.capability)
    return (
      <GitWorktreePane
        repo={repo}
        workspaceProbe={props.workspaceShell.capability.probe}
        worktreePath={props.workspacePaneRouteContext.worktreePath}
        route={props.workspacePaneRouteContext.route}
        workspacePaneId={props.workspacePaneId}
        toolbarNavigationOffset={props.toolbarNavigationOffset}
        onBackToNavigator={props.onBackToGitWorkspaceNavigator}
      />
    )
  }
  // The selected pane target owns presentation. Capability discovery may
  // expose Git navigation, but it must not replace an already-open
  // filesystem workspace with an unrelated branch surface.
  if (
    props.workspacePaneRouteContext.kind === 'workspace-root' ||
    props.workspaceShell.capability.kind === 'filesystem'
  ) {
    return (
      <WorkspaceRootPane
        workspace={{
          id: props.workspaceShell.id,
          workspaceRuntimeId: props.workspaceShell.workspaceRuntimeId,
          ui: props.workspaceShell.ui,
          probe: props.workspaceShell.capability.probe,
        }}
        workspacePaneId={props.workspacePaneId}
        route={props.workspacePaneRouteContext.kind === 'workspace-root' ? props.workspacePaneRouteContext.route : null}
        toolbarNavigationOffset={props.toolbarNavigationOffset}
        onBackToNavigator={props.onBackToGitWorkspaceNavigator}
      />
    )
  }
  if (props.workspaceShell.capability.kind !== 'git') {
    return <WorkspacePaneSkeleton toolbarNavigationOffset={props.toolbarNavigationOffset} />
  }
  return (
    <GitWorkspacePane
      gitWorkspace={gitWorkspacePaneShell(props.workspaceShell, props.workspaceShell.capability)}
      workspacePaneRouteContext={props.workspacePaneRouteContext}
      workspacePaneId={props.workspacePaneId}
      shortcutsEnabled={props.shortcutsEnabled}
      toolbarNavigationOffset={props.toolbarNavigationOffset}
      onBackToGitWorkspaceNavigator={props.onBackToGitWorkspaceNavigator}
    />
  )
}

WorkspacePaneLoaded.props = [
  'workspaceShell',
  'workspacePaneRouteContext',
  'workspacePaneId',
  'shortcutsEnabled',
  'toolbarNavigationOffset',
  'onBackToGitWorkspaceNavigator',
]

function gitWorkspacePaneShell(
  workspace: WorkspacePaneShell,
  capability: Extract<WorkspaceCapabilityState, { kind: 'git' }>,
): GitWorkspacePaneShell {
  const git = capability.git
  return {
    id: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    ui: workspace.ui,
    probe: capability.probe,
    operations: { branchAction: git.operations.branchAction },
    remoteLifecycle: workspace.admission.kind === 'remote' ? workspace.admission.lifecycle : null,
  }
}
