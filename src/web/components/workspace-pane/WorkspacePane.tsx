import { useCallback, useId, useMemo } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  getCurrentGitWorkspacePanePresentation,
  type GitWorkspacePaneProjection,
  type CurrentGitWorkspacePanePresentation,
  type PullRequestReadPresentation,
} from '#/web/components/repo-workspace/model.ts'
import { GitWorkspacePaneToolbar } from '#/web/components/repo-workspace/GitWorkspacePaneToolbar.tsx'
import { GitWorkspacePaneContent } from '#/web/components/repo-workspace/GitWorkspacePaneContent.tsx'
import {
  useGitWorktreeWorkspacePaneTabModel,
  useWorkspaceRootTabModel,
  useGitWorkspacePaneTabModel,
  type WorkspacePaneRuntimeContext,
} from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'
import { useBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import { useBranchActionShortcutRegistry } from '#/web/hooks/useBranchActionShortcutRegistry.ts'
import { useBranchActions, type BranchActions } from '#/web/hooks/useBranchActions.tsx'
import { BranchActionSurfaceContext } from '#/web/components/repo-workspace/branch-action-surface-context.ts'
import {
  useRepoOperationsReadModel,
  useRepoPullRequestsReadModel,
  useRepoSnapshotReadModel,
  useRepoWorktreeStatusReadModel,
} from '#/web/repo-queries.ts'
import { useWorkspaceDirectoryOverview } from '#/web/workspace-directory-overview-query.ts'
import { WorkspacePaneSkeleton } from '#/web/components/Skeleton.tsx'
import { RepoStatusFailureView, RepoStatusStaleNotice } from '#/web/components/RepoStatusFailureView.tsx'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { useGitWorkspacePaneRouteController } from '#/web/components/repo-workspace/git-workspace-pane-route-controller.ts'
import { projectBranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type {
  GitWorkspaceClientState,
  WorkspaceCapabilityState,
  WorkspaceState,
} from '#/web/stores/workspaces/types.ts'
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
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import { dispatchOpenWorkspacePaneTargetStaticTabAction } from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
import { useFilesystemWorkspacePaneRouteController } from '#/web/workspace-pane/filesystem-workspace-pane-route-controller.ts'

export type WorkspacePaneRouteContext =
  | { kind: 'workspace-root'; route: ParsedWorkspacePaneRoute | null }
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
type GitWorkspacePaneShell = Omit<GitWorkspacePaneProjection, 'snapshot' | 'status' | 'branchAction'> & {
  operations: Pick<GitWorkspaceClientState['operations'], 'branchAction'>
  probe: WorkspaceReadyProbeState
}

interface WorkspacePaneShell {
  id: WorkspaceState['id']
  workspaceRuntimeId: string
  ui: Pick<WorkspaceState['ui'], 'preferredWorkspacePaneTabByTarget'> & { currentBranchName: string | null }
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
    probe: capability.probe,
    operations: { branchAction: git.operations.branchAction },
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
    const error = statusReadModel.error
    return (
      <RepoStatusFailureView
        messageKey={error instanceof Error ? error.message : String(error)}
        retrying={statusReadModel.isFetching}
        onRetry={() => void statusReadModel.refetch()}
      />
    )
  }
  if (!target || !worktree) {
    return <EmptyState title={t('workspace-route.not-found-title')} />
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
  const model = useGitWorktreeWorkspacePaneTabModel(workspaceRuntime, target, head, route)
  useFilesystemWorkspacePaneRouteController({ route, model })
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
          <WorkspaceFilesystemTabPanel routeTarget={target} target={surfaceTarget} />
        </WorkspacePanePanelFrame>
      ) : model.selection?.tab === 'terminal' && runtimeTarget ? (
        renderWorkspacePaneRuntimeTabPanel({
          type: 'terminal',
          workspacePaneId,
          panelLabel: { label: t('tab.terminal') },
          target: {
            routeTarget: target,
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
  const snapshotReadModel = useRepoSnapshotReadModel(gitWorkspace.id, gitWorkspace.workspaceRuntimeId, true)
  const snapshot = snapshotReadModel.data?.snapshot
  const pullRequestsReadModel = useRepoPullRequestsReadModel(
    gitWorkspace.id,
    gitWorkspace.workspaceRuntimeId,
    { kind: 'branch-detail', branch: currentBranchName ?? '' },
    currentBranchName !== null,
  )
  const operationsReadModel = useRepoOperationsReadModel(gitWorkspace.id, gitWorkspace.workspaceRuntimeId)
  const statusReadModel = useRepoWorktreeStatusReadModel(gitWorkspace.id, gitWorkspace.workspaceRuntimeId, true)
  const statusSnapshot = statusReadModel.data
  if (!snapshot && snapshotReadModel.isError) {
    const snapshotError = snapshotReadModel.error
    const messageKey = snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
    return (
      <RepoStatusFailureView
        messageKey={messageKey}
        retrying={snapshotReadModel.isFetching}
        onRetry={() => void snapshotReadModel.refetch()}
      />
    )
  }
  if (!snapshot) {
    return <WorkspacePaneSkeleton toolbarTrafficLightOffset={toolbarTrafficLightOffset} />
  }
  const pullRequest = pullRequestsReadModel.data?.pullRequests?.[0]?.pullRequest
  const pullRequestError = pullRequestsReadModel.error
  const pullRequestErrorKey =
    pullRequestError instanceof Error ? pullRequestError.message : pullRequestError ? String(pullRequestError) : null
  const pullRequestRead: PullRequestReadPresentation = {
    state: !pullRequestsReadModel.data
      ? pullRequestsReadModel.isError
        ? 'error'
        : 'pending'
      : pullRequestsReadModel.isError
        ? 'stale'
        : pullRequestsReadModel.data.pullRequests === null
          ? 'unavailable'
          : pullRequestsReadModel.data.pullRequests.length === 0
            ? 'empty'
            : 'ready',
    error: pullRequestErrorKey,
    retrying: pullRequestsReadModel.isFetching,
    retry: () => void pullRequestsReadModel.refetch(),
  }
  const gitWorkspacePaneProjection: GitWorkspacePaneProjection = {
    ...projectBranchActionRepo(gitWorkspace, operationsReadModel.data?.operations, currentBranchName),
    snapshot,
    status: statusSnapshot?.status,
    probe: gitWorkspace.probe,
  }
  const statusError = statusReadModel.error
  const statusErrorKey = statusError instanceof Error ? statusError.message : statusError ? String(statusError) : null
  const detailBase = getCurrentGitWorkspacePanePresentation(
    gitWorkspacePaneProjection,
    {
      loading: statusReadModel.isPending || statusReadModel.isFetching,
      error: statusErrorKey,
      stale: !!statusSnapshot && statusReadModel.isError,
    },
    pullRequest,
    pullRequestRead,
  )
  const detail: CurrentGitWorkspacePanePresentation = {
    ...detailBase,
    loading: {
      ...detailBase.loading,
      pullRequests: pullRequestsReadModel.isPending || pullRequestsReadModel.isFetching,
    },
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      {snapshotReadModel.isError && (
        <RepoStatusStaleNotice
          messageKey={
            snapshotReadModel.error instanceof Error ? snapshotReadModel.error.message : String(snapshotReadModel.error)
          }
          retrying={snapshotReadModel.isFetching}
          onRetry={() => void snapshotReadModel.refetch()}
        />
      )}
      {detail.branch ? (
        <GitBranchActionWorkspacePane
          repo={gitWorkspacePaneProjection}
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
          repo={gitWorkspacePaneProjection}
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
  route,
  toolbarTrafficLightOffset,
  onBackToNavigator,
}: {
  workspace: FilesystemWorkspacePaneProjection
  workspacePaneId: string
  route: ParsedWorkspacePaneRoute | null
  toolbarTrafficLightOffset: boolean
  onBackToNavigator?: () => void
}) {
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  const model = useWorkspaceRootTabModel(workspace, route)
  useFilesystemWorkspacePaneRouteController({ route, model })
  const target = useMemo(() => ({ kind: 'workspace-root' as const, workspaceId: workspace.id }), [workspace.id])
  const runtimeTarget = runtimeWorkspacePaneTarget(target, workspace.workspaceRuntimeId)
  const activePanel = model.selection?.tab ?? null
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
  const openFilesTab = useCallback(() => {
    void dispatchOpenWorkspacePaneTargetStaticTabAction({
      workspaceId: workspace.id,
      routeTarget: target,
      paneTarget: target,
      type: 'files',
      workspacePaneRoute: { kind: 'static', tab: 'status' },
      navigation,
    })
  }, [navigation, target, workspace.id])
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <WorkspacePaneTargetToolbar
        target={surfaceTarget}
        model={model}
        workspacePaneId={workspacePaneId}
        workspacePaneRoute={route}
        statusCount={0}
        trafficLightOffset={toolbarTrafficLightOffset}
        onBackToNavigator={onBackToNavigator}
        staticTabAvailable={(type) => type === 'status' || type === 'files'}
      />
      {activePanel === 'status' ? (
        <WorkspacePanePanelFrame id={`${workspacePaneId}-status-panel`} label={t('tab.status')}>
          <ScrollPane>
            {overviewReadModel.data ? (
              <WorkspaceDirectoryStatus
                overview={overviewReadModel.data}
                workingDirectory={formatWorkspaceDisplayLocation(workspace.id)}
                onOpenFiles={openFilesTab}
              />
            ) : overviewReadModel.isError ? (
              <div className="p-4 text-sm text-destructive">{t('dashboard.directory.read-failed')}</div>
            ) : (
              <div className="p-4 text-sm text-muted-foreground">{t('dashboard.loading')}</div>
            )}
          </ScrollPane>
        </WorkspacePanePanelFrame>
      ) : activePanel === 'files' ? (
        <WorkspacePanePanelFrame id={`${workspacePaneId}-files-panel`} label={t('tab.files')}>
          <WorkspaceFilesystemTabPanel routeTarget={target} target={surfaceTarget} />
        </WorkspacePanePanelFrame>
      ) : activePanel === 'terminal' && runtimeTarget ? (
        renderWorkspacePaneRuntimeTabPanel({
          type: 'terminal',
          workspacePaneId,
          panelLabel: { label: t('tab.terminal') },
          target: {
            routeTarget: target,
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
