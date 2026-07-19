import { useCallback, useId, useMemo } from 'react'
import { omit } from 'es-toolkit'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  getCurrentGitWorkspacePanePresentation,
  type GitWorkspacePaneProjection,
  type CurrentGitWorkspacePanePresentation,
} from '#/web/components/repo-workspace/model.ts'
import { GitWorkspacePaneToolbar } from '#/web/components/repo-workspace/GitWorkspacePaneToolbar.tsx'
import { GitWorkspacePaneContent } from '#/web/components/repo-workspace/GitWorkspacePaneContent.tsx'
import {
  useGitWorktreeWorkspacePaneTabModel,
  useWorkspaceRootTabModel,
  useGitWorkspacePaneTabModel,
  type WorkspacePaneRuntimeContext,
} from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'
import { useGitWorkspacePaneVisibleStatusRefresh } from '#/web/components/repo-workspace/use-git-workspace-pane-visible-status-refresh.ts'
import { useBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import { useBranchActionShortcutRegistry } from '#/web/hooks/useBranchActionShortcutRegistry.ts'
import { useBranchActions, type BranchActions } from '#/web/hooks/useBranchActions.tsx'
import { BranchActionSurfaceContext } from '#/web/components/repo-workspace/branch-action-surface-context.ts'
import {
  useRepoProjectionReadModel,
  useRepoWorktreeStatusReadModel,
  useWorkspaceDirectoryOverview,
} from '#/web/repo-data-query.ts'
import { repoBranchReadModelFromSnapshot } from '#/web/repo-branch-read-model.ts'
import { WorkspacePaneSkeleton } from '#/web/components/Skeleton.tsx'
import { RepoStatusFailureView } from '#/web/components/RepoStatusFailureView.tsx'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { useGitWorkspacePaneRouteController } from '#/web/components/repo-workspace/git-workspace-pane-route-controller.ts'
import { projectBranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { isWorkspaceUnavailable } from '#/web/stores/workspaces/workspace-guards.ts'
import type { GitWorkspaceProjection, WorkspaceCapabilityState, WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
import { useT } from '#/web/stores/i18n.ts'
import { WorkspaceFilesystemTabPanel } from '#/web/components/workspace-pane/WorkspaceFilesystemTabPanel.tsx'
import { WorkspacePanePanelFrame } from '#/web/components/workspace-pane/WorkspacePanePanelFrame.tsx'
import { renderWorkspacePaneRuntimeTabPanel } from '#/web/workspace-pane/workspace-pane-runtime-tab-panel.tsx'
import { gitWorktreeWorkspacePaneTabsTarget, runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { WorkspacePaneTargetToolbar } from '#/web/components/workspace-pane/WorkspacePaneTargetToolbar.tsx'
import {
  gitWorktreePaneFilesystemTarget,
  workspaceRootPaneFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { WorkspaceDirectoryStatus } from '#/web/components/workspace-pane/WorkspaceDirectoryStatus.tsx'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import type { WorkspaceGitReadyProbeState, WorkspaceReadyProbeState } from '#/shared/workspace-runtime.ts'
import { gitHead, type GitHead } from '#/shared/git-head.ts'
import type { GitWorktreeWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { StatusList } from '#/web/components/StatusList.tsx'
import type { WorktreeStatus } from '#/web/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export type WorkspacePaneRouteContext =
  | { kind: 'workspace-root' }
  | { kind: 'git-worktree'; worktreePath: string; route: ParsedWorkspacePaneRoute | null }
  | { kind: 'routed'; route: ParsedWorkspacePaneRoute | null }
  | { kind: 'inactive' }

interface Props {
  workspaceId: WorkspaceId
  currentBranchName?: string | null
  workspacePaneRouteContext: WorkspacePaneRouteContext
  shortcutsEnabled?: boolean
  toolbarTrafficLightOffset?: boolean
  onBackToBranchNavigator?: () => void
}

// Keep this equality in sync with fields read by WorkspacePane children.
type GitWorkspacePaneShell = Omit<GitWorkspacePaneProjection, 'branchModel' | 'branchAction'> & {
  operations: Pick<GitWorkspaceProjection['operations'], 'branchAction'>
  probe: WorkspaceReadyProbeState
}

interface WorkspacePaneShell {
  id: WorkspaceState['id']
  workspaceRuntimeId: string
  ui: Pick<WorkspaceState['ui'], 'preferredWorkspacePaneTabByTarget'> & { currentBranchName: string | null }
  unavailable: boolean
  capability: WorkspaceCapabilityState
  admission: WorkspaceState['admission']
}

interface FilesystemWorkspacePaneProjection {
  id: WorkspaceId
  workspaceRuntimeId: string
  ui: WorkspacePaneShell['ui']
  probe: WorkspaceReadyProbeState
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
      a.unavailable === b.unavailable &&
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
            unavailable: isWorkspaceUnavailable(workspace),
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
        toolbarTrafficLightOffset={props.toolbarTrafficLightOffset}
        onBackToNavigator={props.onBackToBranchNavigator}
      />
    )
  }
  if (props.workspaceShell.capability.kind !== 'git') {
    return <WorkspacePaneSkeleton toolbarTrafficLightOffset={props.toolbarTrafficLightOffset} />
  }
  return (
    <GitWorkspacePaneLoaded
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
    unavailable: workspace.unavailable,
    probe: capability.probe,
    operations: { branchAction: git.operations.branchAction },
    remote: git.remote,
    remoteLifecycle: workspace.admission.kind === 'remote' ? workspace.admission.lifecycle : null,
  }
}

function GitWorktreeFilesystemPane({
  repo,
  workspaceProbe,
  worktreePath,
  route,
  workspacePaneId,
  toolbarTrafficLightOffset,
  onBackToNavigator,
}: {
  repo: GitWorkspacePaneShell
  workspaceProbe: WorkspaceGitReadyProbeState
  worktreePath: string
  route: ParsedWorkspacePaneRoute | null
  workspacePaneId: string
  toolbarTrafficLightOffset: boolean
  onBackToNavigator?: () => void
}) {
  const t = useT()
  const statusReadModel = useRepoWorktreeStatusReadModel(repo.id, repo.workspaceRuntimeId, true)
  const worktree = statusReadModel.data?.status.find((candidate) => candidate.path === worktreePath)
  const target = gitWorktreeWorkspacePaneTabsTarget(repo.id, worktreePath)
  if (statusReadModel.isPending) {
    return <WorkspacePaneSkeleton toolbarTrafficLightOffset={toolbarTrafficLightOffset} />
  }
  if (statusReadModel.isError) {
    return <EmptyState title={t('dashboard.directory.read-failed')} />
  }
  if (!target || !worktree) {
    return <EmptyState title={t('repo-route.not-found-title')} />
  }
  return (
    <GitWorktreeFilesystemPaneReady
      workspaceRuntime={{ workspaceRuntimeId: repo.workspaceRuntimeId, ui: repo.ui }}
      workspaceProbe={workspaceProbe}
      head={gitHead(worktree.branch ?? null)}
      status={worktree}
      target={target}
      route={route}
      workspacePaneId={workspacePaneId}
      toolbarTrafficLightOffset={toolbarTrafficLightOffset}
      onBackToNavigator={onBackToNavigator}
    />
  )
}

function GitWorktreeFilesystemPaneReady({
  workspaceRuntime,
  workspaceProbe,
  head,
  status,
  target,
  route,
  workspacePaneId,
  toolbarTrafficLightOffset,
  onBackToNavigator,
}: {
  workspaceRuntime: WorkspacePaneRuntimeContext
  workspaceProbe: WorkspaceGitReadyProbeState
  head: GitHead
  status: WorktreeStatus
  target: GitWorktreeWorkspacePaneTabsTarget
  route: ParsedWorkspacePaneRoute | null
  workspacePaneId: string
  toolbarTrafficLightOffset: boolean
  onBackToNavigator?: () => void
}) {
  const t = useT()
  const worktreePath = target.worktreePath
  const requestedSessionId = route?.kind === 'terminal' ? route.terminalSessionId : null
  const requestedTab = route?.kind === 'terminal' ? 'terminal' : route?.kind === 'static' ? route.tab : null
  const model = useGitWorktreeWorkspacePaneTabModel(workspaceRuntime, target, head, requestedTab, requestedSessionId)
  const runtimeTarget = runtimeWorkspacePaneTarget(target, workspaceRuntime.workspaceRuntimeId)
  const selectedTerminalSessionId =
    model.selection?.kind === 'materialized-tab' && model.selection.materializedTab.kind === 'runtime'
      ? model.selection.materializedTab.sessionId
      : null
  const surfaceTarget = gitWorktreePaneFilesystemTarget({
    workspaceId: target.workspaceId,
    workspaceRuntimeId: workspaceRuntime.workspaceRuntimeId,
    worktreePath,
    head,
    capabilities: workspaceProbe.capabilities,
  })
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background" data-testid="detached-worktree-pane">
      <WorkspacePaneTargetToolbar
        target={surfaceTarget}
        model={model}
        workspacePaneId={workspacePaneId}
        workspacePaneRoute={route}
        statusCount={status.entries.length}
        trafficLightOffset={toolbarTrafficLightOffset}
        onBackToNavigator={onBackToNavigator}
        staticTabAvailable={(type) => type === 'status' || type === 'files'}
      />
      {model.selection?.tab === 'status' ? (
        <WorkspacePanePanelFrame id={`${workspacePaneId}-status-panel`} label={t('tab.status')}>
          <ScrollPane>
            <StatusList status={[status]} />
          </ScrollPane>
        </WorkspacePanePanelFrame>
      ) : model.selection?.tab === 'files' ? (
        <WorkspacePanePanelFrame id={`${workspacePaneId}-files-panel`} label={t('tab.files')}>
          <WorkspaceFilesystemTabPanel target={surfaceTarget} />
        </WorkspacePanePanelFrame>
      ) : model.selection?.tab === 'terminal' && runtimeTarget ? (
        renderWorkspacePaneRuntimeTabPanel({
          type: 'terminal',
          workspacePaneId,
          panelLabel: { label: t('tab.terminal') },
          target: {
            runtimeTarget,
            presentation: { kind: 'git-worktree', head },
          },
          selectedSessionId: selectedTerminalSessionId,
          runtimeState: model.runtimeTabStateByType.terminal,
        })
      ) : (
        <EmptyState title={t('workspace-pane-tabs.empty')} />
      )}
    </section>
  )
}

function GitWorkspacePaneLoaded({
  gitWorkspace,
  workspacePaneRouteContext,
  workspacePaneId,
  shortcutsEnabled,
  toolbarTrafficLightOffset,
  onBackToBranchNavigator,
}: {
  gitWorkspace: GitWorkspacePaneShell
  workspacePaneRouteContext: WorkspacePaneRouteContext
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset: boolean
  onBackToBranchNavigator?: () => void
}) {
  const currentBranchName = gitWorkspace.ui.currentBranchName
  const projectionReadModel = useRepoProjectionReadModel(
    gitWorkspace.id,
    gitWorkspace.workspaceRuntimeId,
    currentBranchName,
    'full',
    true,
  )
  const projection = projectionReadModel.data
  const statusReadModel = useRepoWorktreeStatusReadModel(gitWorkspace.id, gitWorkspace.workspaceRuntimeId, true)
  const statusSnapshot = statusReadModel.data
  if (projection?.snapshot && !statusSnapshot && statusReadModel.isError) {
    const statusErrorKey =
      statusReadModel.error instanceof Error ? statusReadModel.error.message : String(statusReadModel.error)
    return (
      <section className="flex min-h-0 flex-1 flex-col bg-background">
        <RepoStatusFailureView
          messageKey={statusErrorKey}
          retrying={statusReadModel.isFetching}
          onRetry={() => {
            void refreshRepoWorktreeStatus(
              { get: useWorkspacesStore.getState },
              gitWorkspace.id,
              gitWorkspace.workspaceRuntimeId,
            )
          }}
        />
      </section>
    )
  }
  const branchReadModel =
    projection?.snapshot && statusSnapshot
      ? repoBranchReadModelFromSnapshot(projection.snapshot, statusSnapshot.status)
      : null
  if (!branchReadModel || !projection) {
    return <WorkspacePaneSkeleton toolbarTrafficLightOffset={toolbarTrafficLightOffset} />
  }
  let presentationBranchModel: GitWorkspacePaneProjection['branchModel'] = branchReadModel
  if (currentBranchName && Array.isArray(projection.pullRequests)) {
    const pullRequest = projection.pullRequests.find((entry) => entry.branch === currentBranchName)?.pullRequest
    presentationBranchModel = {
      ...presentationBranchModel,
      branches: presentationBranchModel.branches.map((branch) => {
        if (branch.name !== currentBranchName) return branch
        if (pullRequest) return { ...branch, pullRequest }
        return omit(branch, ['pullRequest'])
      }),
    }
  }
  const gitWorkspaceProjection: GitWorkspacePaneProjection = {
    ...projectBranchActionRepo(gitWorkspace, projection.operations.operations, currentBranchName),
    branchModel: presentationBranchModel,
    probe: gitWorkspace.probe,
  }
  const statusError = statusReadModel.error
  const statusErrorKey = statusError instanceof Error ? statusError.message : statusError ? String(statusError) : null
  const detailBase = getCurrentGitWorkspacePanePresentation(gitWorkspaceProjection, {
    loading: statusReadModel.isFetching,
    error: statusErrorKey,
    stale: !!statusSnapshot && statusReadModel.isError,
  })
  const detail: CurrentGitWorkspacePanePresentation = {
    ...detailBase,
    loading: {
      ...detailBase.loading,
      pullRequests: projectionReadModel.isFetching && !projectionReadModel.dataUpdatedAt,
    },
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      {detail.branch ? (
        <GitBranchActionWorkspacePane
          repo={gitWorkspaceProjection}
          detail={detail}
          workspacePaneRouteContext={workspacePaneRouteContext}
          branch={detail.branch}
          workspacePaneId={workspacePaneId}
          shortcutsEnabled={shortcutsEnabled}
          toolbarTrafficLightOffset={toolbarTrafficLightOffset}
          onBackToBranchNavigator={onBackToBranchNavigator}
        />
      ) : (
        <GitWorkspacePaneSurface
          repo={gitWorkspaceProjection}
          detail={detail}
          workspacePaneRouteContext={workspacePaneRouteContext}
          workspacePaneId={workspacePaneId}
          toolbarTrafficLightOffset={toolbarTrafficLightOffset}
          onBackToBranchNavigator={onBackToBranchNavigator}
        />
      )}
    </section>
  )
}

function WorkspaceRootPane({
  workspace,
  workspacePaneId,
  toolbarTrafficLightOffset,
  onBackToNavigator,
}: {
  workspace: FilesystemWorkspacePaneProjection
  workspacePaneId: string
  toolbarTrafficLightOffset: boolean
  onBackToNavigator?: () => void
}) {
  const t = useT()
  const model = useWorkspaceRootTabModel(workspace)
  const target = { kind: 'workspace-root' as const, workspaceId: workspace.id }
  const runtimeTarget = runtimeWorkspacePaneTarget(target, workspace.workspaceRuntimeId)
  const terminalAvailable = workspace.probe.capabilities.terminal.available
  const activePanel = model.selection?.tab === 'terminal' && !terminalAvailable ? null : (model.selection?.tab ?? null)
  const overviewReadModel = useWorkspaceDirectoryOverview(
    workspace.id,
    workspace.workspaceRuntimeId,
    activePanel === 'status',
  )
  const selectedTerminalSessionId =
    model.selection?.kind === 'materialized-tab' && model.selection.materializedTab.kind === 'runtime'
      ? model.selection.materializedTab.sessionId
      : null
  const surfaceTarget = workspaceRootPaneFilesystemTarget({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    capabilities: workspace.probe.capabilities,
  })
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <WorkspacePaneTargetToolbar
        target={surfaceTarget}
        model={model}
        workspacePaneId={workspacePaneId}
        workspacePaneRoute={undefined}
        statusCount={0}
        trafficLightOffset={toolbarTrafficLightOffset}
        onBackToNavigator={onBackToNavigator}
        staticTabAvailable={(type) => type === 'status' || type === 'files'}
      />
      {activePanel === 'status' ? (
        <WorkspacePanePanelFrame id={`${workspacePaneId}-status-panel`} label={t('tab.status')}>
          <ScrollPane>
            {overviewReadModel.data ? (
              <WorkspaceDirectoryStatus overview={overviewReadModel.data} />
            ) : overviewReadModel.isError ? (
              <div className="p-4 text-sm text-destructive">{t('dashboard.directory.read-failed')}</div>
            ) : (
              <div className="p-4 text-sm text-muted-foreground">{t('dashboard.loading')}</div>
            )}
          </ScrollPane>
        </WorkspacePanePanelFrame>
      ) : activePanel === 'files' ? (
        <WorkspacePanePanelFrame id={`${workspacePaneId}-files-panel`} label={t('tab.files')}>
          <WorkspaceFilesystemTabPanel target={surfaceTarget} />
        </WorkspacePanePanelFrame>
      ) : activePanel === 'terminal' && runtimeTarget ? (
        renderWorkspacePaneRuntimeTabPanel({
          type: 'terminal',
          workspacePaneId,
          panelLabel: { label: t('tab.terminal') },
          target: {
            runtimeTarget,
            presentation: { kind: 'workspace-root' },
          },
          selectedSessionId: selectedTerminalSessionId,
          runtimeState: model.runtimeTabStateByType.terminal,
        })
      ) : (
        <EmptyState title={t('workspace-pane-tabs.empty')} />
      )}
    </section>
  )
}

interface GitWorkspacePaneSurfaceProps {
  repo: GitWorkspacePaneProjection
  detail: CurrentGitWorkspacePanePresentation
  workspacePaneRouteContext: WorkspacePaneRouteContext
  workspacePaneId: string
  toolbarTrafficLightOffset?: boolean
  branchActions?: BranchActions
  onBackToBranchNavigator?: () => void
}

function GitWorkspacePaneSurface({
  repo,
  detail,
  workspacePaneRouteContext,
  workspacePaneId,
  toolbarTrafficLightOffset = false,
  branchActions,
  onBackToBranchNavigator,
}: GitWorkspacePaneSurfaceProps) {
  const workspacePaneRoute = workspacePaneRouteContext.kind === 'routed' ? workspacePaneRouteContext.route : undefined
  const routeControllerRoute = workspacePaneRouteContext.kind === 'routed' ? workspacePaneRouteContext.route : null
  const workspacePaneTabModel = useGitWorkspacePaneTabModel(repo, detail, workspacePaneRoute)
  useGitWorkspacePaneVisibleStatusRefresh({
    workspaceId: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    branchName: workspacePaneTabModel.branchName,
    renderedTab: workspacePaneTabModel.renderedTab,
    unavailable: repo.unavailable,
  })
  useGitWorkspacePaneRouteController({
    enabled: workspacePaneRouteContext.kind === 'routed',
    workspaceId: repo.id,
    branchName: detail.branch?.name ?? null,
    worktreePath: detail.branch?.worktree?.path ?? null,
    route: routeControllerRoute,
    model: workspacePaneTabModel,
  })

  return (
    <>
      <GitWorkspacePaneToolbar
        repo={repo}
        detail={detail}
        workspacePaneId={workspacePaneId}
        workspacePaneRoute={workspacePaneRoute}
        trafficLightOffset={toolbarTrafficLightOffset}
        workspacePaneTabModel={workspacePaneTabModel}
        branchActions={branchActions}
        onBackToBranchNavigator={onBackToBranchNavigator}
      />
      <GitWorkspacePaneContent
        repo={repo}
        detail={detail}
        workspacePaneId={workspacePaneId}
        workspacePaneTabModel={workspacePaneTabModel}
        onBackToBranchNavigator={onBackToBranchNavigator}
        onRetryStatus={() => {
          void refreshRepoWorktreeStatus({ get: useWorkspacesStore.getState }, repo.id, repo.workspaceRuntimeId)
        }}
      />
    </>
  )
}

interface GitBranchActionWorkspacePaneProps {
  repo: GitWorkspacePaneProjection
  detail: CurrentGitWorkspacePanePresentation
  workspacePaneRouteContext: WorkspacePaneRouteContext
  branch: NonNullable<CurrentGitWorkspacePanePresentation['branch']>
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset?: boolean
  onBackToBranchNavigator?: () => void
}

function GitBranchActionWorkspacePane({
  repo,
  detail,
  workspacePaneRouteContext,
  branch,
  workspacePaneId,
  shortcutsEnabled,
  toolbarTrafficLightOffset = false,
  onBackToBranchNavigator,
}: GitBranchActionWorkspacePaneProps) {
  const workspacePaneRoute = workspacePaneRouteContext.kind === 'routed' ? workspacePaneRouteContext.route : undefined
  const branchActions = useBranchActions(repo, branch)
  const actions = useBranchActionItems(repo, branch, branchActions, { workspacePaneRoute })
  useBranchActionShortcutRegistry(actions, shortcutsEnabled)

  return (
    <BranchActionSurfaceContext value={actions}>
      <GitWorkspacePaneSurface
        repo={repo}
        detail={detail}
        workspacePaneRouteContext={workspacePaneRouteContext}
        workspacePaneId={workspacePaneId}
        toolbarTrafficLightOffset={toolbarTrafficLightOffset}
        branchActions={branchActions}
        onBackToBranchNavigator={onBackToBranchNavigator}
      />
    </BranchActionSurfaceContext>
  )
}
