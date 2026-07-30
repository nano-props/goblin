import { useId } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { GitWorkspacePane } from '#/web/components/workspace-pane/GitWorkspacePane.tsx'
import { GitWorktreeFilesystemPane } from '#/web/components/workspace-pane/GitWorktreeFilesystemPane.tsx'
import { WorkspaceRootPane } from '#/web/components/workspace-pane/WorkspaceRootPane.tsx'
import type {
  GitWorkspacePaneShell,
  WorkspacePaneRouteContext,
} from '#/web/components/workspace-pane/workspace-pane-types.ts'
import { WorkspacePaneSkeleton } from '#/web/components/Skeleton.tsx'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspaceCapabilityState, WorkspaceState } from '#/web/stores/workspaces/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

interface Props {
  workspaceId: WorkspaceId
  currentBranchName?: string | null
  workspacePaneRouteContext: WorkspacePaneRouteContext
  shortcutsEnabled?: boolean
  toolbarTrafficLightOffset?: boolean
  onBackToBranchNavigator?: () => void
}

interface WorkspacePaneShell {
  id: WorkspaceState['id']
  workspaceRuntimeId: string
  ui: Pick<WorkspaceState['ui'], 'preferredWorkspacePaneTabByTarget'> & { currentBranchName: string | null }
  capability: WorkspaceCapabilityState
  admission: WorkspaceState['admission']
}

function workspacePaneShellEqual(a: WorkspacePaneShell | undefined, b: WorkspacePaneShell | undefined): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.workspaceRuntimeId === b.workspaceRuntimeId &&
      a.ui.currentBranchName === b.ui.currentBranchName &&
      a.ui.preferredWorkspacePaneTabByTarget === b.ui.preferredWorkspacePaneTabByTarget &&
      a.capability === b.capability &&
      a.admission === b.admission)
  )
}

export function WorkspacePane({
  workspaceId,
  currentBranchName,
  workspacePaneRouteContext,
  shortcutsEnabled = true,
  toolbarTrafficLightOffset = false,
  onBackToBranchNavigator,
}: Props) {
  const workspacePaneId = useId()
  const workspaceShell = useStoreWithEqualityFn(
    useWorkspacesStore,
    (s) => {
      const workspace = s.workspaces[workspaceId]
      const currentBranch = workspace ? (currentBranchName ?? null) : null
      return workspace
        ? {
            id: workspace.id,
            workspaceRuntimeId: workspace.workspaceRuntimeId,
            ui: {
              currentBranchName: currentBranch,
              preferredWorkspacePaneTabByTarget: workspace.ui.preferredWorkspacePaneTabByTarget,
            },
            capability: workspace.capability,
            admission: workspace.admission,
          }
        : undefined
    },
    workspacePaneShellEqual,
  )
  if (!workspaceShell) return null

  return (
    <WorkspacePaneLoaded
      workspaceShell={workspaceShell}
      workspacePaneRouteContext={workspacePaneRouteContext}
      workspacePaneId={workspacePaneId}
      shortcutsEnabled={shortcutsEnabled}
      toolbarTrafficLightOffset={toolbarTrafficLightOffset}
      onBackToBranchNavigator={onBackToBranchNavigator}
    />
  )
}

function WorkspacePaneLoaded(props: {
  workspaceShell: WorkspacePaneShell
  workspacePaneRouteContext: WorkspacePaneRouteContext
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset: boolean
  onBackToBranchNavigator?: () => void
}) {
  if (props.workspaceShell.capability.kind === 'probing' || props.workspaceShell.capability.kind === 'unavailable') {
    return <WorkspacePaneSkeleton toolbarTrafficLightOffset={props.toolbarTrafficLightOffset} />
  }
  if (props.workspacePaneRouteContext.kind === 'git-worktree' && props.workspaceShell.capability.kind === 'git') {
    const repo = gitWorkspacePaneShell(props.workspaceShell, props.workspaceShell.capability)
    return (
      <GitWorktreeFilesystemPane
        repo={repo}
        workspaceProbe={props.workspaceShell.capability.probe}
        worktreePath={props.workspacePaneRouteContext.worktreePath}
        route={props.workspacePaneRouteContext.route}
        workspacePaneId={props.workspacePaneId}
        toolbarTrafficLightOffset={props.toolbarTrafficLightOffset}
        onBackToNavigator={props.onBackToBranchNavigator}
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
        toolbarTrafficLightOffset={props.toolbarTrafficLightOffset}
        onBackToNavigator={props.onBackToBranchNavigator}
      />
    )
  }
  if (props.workspaceShell.capability.kind !== 'git') {
    return <WorkspacePaneSkeleton toolbarTrafficLightOffset={props.toolbarTrafficLightOffset} />
  }
  return (
    <GitWorkspacePane
      gitWorkspace={gitWorkspacePaneShell(props.workspaceShell, props.workspaceShell.capability)}
      workspacePaneRouteContext={props.workspacePaneRouteContext}
      workspacePaneId={props.workspacePaneId}
      shortcutsEnabled={props.shortcutsEnabled}
      toolbarTrafficLightOffset={props.toolbarTrafficLightOffset}
      onBackToBranchNavigator={props.onBackToBranchNavigator}
    />
  )
}

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
