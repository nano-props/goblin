import { useCallback, useId, useMemo } from 'react'
import { omit } from 'es-toolkit'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  getCurrentRepoWorkspacePresentation,
  type RepoWorkspaceRepo,
  type CurrentRepoWorkspacePresentation,
} from '#/web/components/repo-workspace/model.ts'
import { RepoWorkspaceToolbar } from '#/web/components/repo-workspace/RepoWorkspaceToolbar.tsx'
import { RepoWorkspaceContent } from '#/web/components/repo-workspace/RepoWorkspaceContent.tsx'
import {
  useFilesystemWorkspaceTabModel,
  useWorkspaceRootTabModel,
  useRepoWorkspaceTabModel,
} from '#/web/components/repo-workspace/use-repo-workspace-tab-model.ts'
import { useWorkspacePaneVisibleStatusRefresh } from '#/web/components/repo-workspace/use-workspace-pane-visible-status-refresh.ts'
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
import { RepoWorkspaceSkeleton } from '#/web/components/Skeleton.tsx'
import { RepoStatusFailureView } from '#/web/components/RepoStatusFailureView.tsx'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { useWorkspacePaneRouteController } from '#/web/components/repo-workspace/workspace-pane-route-controller.ts'
import { projectBranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { isRepoUnavailable } from '#/web/stores/workspaces/workspace-guards.ts'
import type { GitWorkspaceProjection, WorkspaceCapabilityState, WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
import { useT } from '#/web/stores/i18n.ts'
import { FiletreeTab } from '#/web/components/repo-workspace/panels.tsx'
import { WorkspacePanePanelFrame } from '#/web/components/workspace-pane/WorkspacePanePanelFrame.tsx'
import { renderWorkspacePaneRuntimeTabPanel } from '#/web/workspace-pane/workspace-pane-runtime-tab-panel.tsx'
import { gitWorktreeWorkspacePaneTabsTarget, runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { WorkspacePaneTargetToolbar } from '#/web/components/workspace-pane/WorkspacePaneTargetToolbar.tsx'
import { WorkspaceDirectoryStatus } from '#/web/components/repo-workspace/WorkspaceDirectoryStatus.tsx'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import type { WorkspaceReadyProbeState } from '#/shared/workspace-runtime.ts'
import { gitHead, type GitHead } from '#/shared/git-head.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { StatusList } from '#/web/components/StatusList.tsx'
import type { WorktreeStatus } from '#/web/types.ts'

export type RepoWorkspacePaneRouteContext =
  | { kind: 'workspace-root' }
  | { kind: 'git-worktree'; worktreePath: string; route: ParsedWorkspacePaneRoute | null }
  | { kind: 'routed'; route: ParsedWorkspacePaneRoute | null }
  | { kind: 'inactive' }

interface Props {
  workspaceId: string
  currentBranchName?: string | null
  workspacePaneRouteContext: RepoWorkspacePaneRouteContext
  shortcutsEnabled?: boolean
  toolbarTrafficLightOffset?: boolean
  onBackToBranchNavigator?: () => void
}

// Keep this equality in sync with fields read by RepoWorkspace children.
type RepoWorkspaceRepoShell = Omit<RepoWorkspaceRepo, 'branchModel' | 'branchAction'> & {
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

export function RepoWorkspace({
  workspaceId,
  currentBranchName,
  workspacePaneRouteContext,
  shortcutsEnabled = true,
  toolbarTrafficLightOffset = false,
  onBackToBranchNavigator,
}: Props) {
  const workspacePaneId = useId()
  const repoShell = useStoreWithEqualityFn(
    useWorkspacesStore,
    (s) => {
      const repo = s.workspaces[workspaceId]
      const currentBranch = repo ? (currentBranchName ?? null) : null
      return repo
        ? {
            id: repo.id,
            workspaceRuntimeId: repo.workspaceRuntimeId,
            ui: {
              currentBranchName: currentBranch,
              preferredWorkspacePaneTabByTarget: repo.ui.preferredWorkspacePaneTabByTarget,
            },
            unavailable: isRepoUnavailable(repo),
            capability: repo.capability,
            admission: repo.admission,
          }
        : undefined
    },
    workspacePaneShellEqual,
  )
  if (!repoShell) return null

  return (
    <RepoWorkspaceLoaded
      repoShell={repoShell}
      workspacePaneRouteContext={workspacePaneRouteContext}
      workspacePaneId={workspacePaneId}
      shortcutsEnabled={shortcutsEnabled}
      toolbarTrafficLightOffset={toolbarTrafficLightOffset}
      onBackToBranchNavigator={onBackToBranchNavigator}
    />
  )
}

function RepoWorkspaceLoaded(props: {
  repoShell: WorkspacePaneShell
  workspacePaneRouteContext: RepoWorkspacePaneRouteContext
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset: boolean
  onBackToBranchNavigator?: () => void
}) {
  if (props.repoShell.capability.kind === 'probing' || props.repoShell.capability.kind === 'unavailable') {
    return <RepoWorkspaceSkeleton toolbarTrafficLightOffset={props.toolbarTrafficLightOffset} />
  }
  if (props.workspacePaneRouteContext.kind === 'git-worktree' && props.repoShell.capability.kind === 'git') {
    const repo = gitRepoWorkspaceShell(props.repoShell, props.repoShell.capability)
    return (
      <GitWorktreeFilesystemPane
        repo={repo}
        workspaceProbe={props.repoShell.capability.probe}
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
  if (props.workspacePaneRouteContext.kind === 'workspace-root' || props.repoShell.capability.kind === 'filesystem') {
    return (
      <WorkspaceRootPane
        repo={{
          id: props.repoShell.id,
          workspaceRuntimeId: props.repoShell.workspaceRuntimeId,
          ui: props.repoShell.ui,
          probe: props.repoShell.capability.probe,
        }}
        workspacePaneId={props.workspacePaneId}
        toolbarTrafficLightOffset={props.toolbarTrafficLightOffset}
        onBackToNavigator={props.onBackToBranchNavigator}
      />
    )
  }
  if (props.repoShell.capability.kind !== 'git') {
    return <RepoWorkspaceSkeleton toolbarTrafficLightOffset={props.toolbarTrafficLightOffset} />
  }
  return (
    <GitRepoWorkspaceLoaded
      {...props}
      repoShell={gitRepoWorkspaceShell(props.repoShell, props.repoShell.capability)}
      workspacePaneRouteContext={props.workspacePaneRouteContext}
    />
  )
}

function gitRepoWorkspaceShell(
  workspace: WorkspacePaneShell,
  capability: Extract<WorkspaceCapabilityState, { kind: 'git' }>,
): RepoWorkspaceRepoShell {
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
  repo: RepoWorkspaceRepoShell
  workspaceProbe: WorkspaceReadyProbeState
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
    return <RepoWorkspaceSkeleton toolbarTrafficLightOffset={toolbarTrafficLightOffset} />
  }
  if (statusReadModel.isError) {
    return <EmptyState title={t('dashboard.directory.read-failed')} />
  }
  if (!target || !worktree) {
    return <EmptyState title={t('repo-route.not-found-title')} />
  }
  return (
    <GitWorktreeFilesystemPaneReady
      repo={repo}
      workspaceProbe={workspaceProbe}
      worktreePath={worktreePath}
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
  repo,
  workspaceProbe,
  worktreePath,
  head,
  status,
  target,
  route,
  workspacePaneId,
  toolbarTrafficLightOffset,
  onBackToNavigator,
}: {
  repo: RepoWorkspaceRepoShell
  workspaceProbe: WorkspaceReadyProbeState
  worktreePath: string
  head: GitHead
  status: WorktreeStatus
  target: WorkspacePaneTabsTarget
  route: ParsedWorkspacePaneRoute | null
  workspacePaneId: string
  toolbarTrafficLightOffset: boolean
  onBackToNavigator?: () => void
}) {
  const t = useT()
  const requestedSessionId = route?.kind === 'terminal' ? route.terminalSessionId : null
  const requestedTab = route?.kind === 'terminal' ? 'terminal' : route?.kind === 'static' ? route.tab : null
  const model = useFilesystemWorkspaceTabModel(repo, target, head, worktreePath, requestedTab, requestedSessionId)
  const runtimeTarget = runtimeWorkspacePaneTarget(target, repo.workspaceRuntimeId)
  const selectedTerminalSessionId =
    model.selection?.kind === 'materialized-tab' && model.selection.materializedTab.kind === 'runtime'
      ? model.selection.materializedTab.sessionId
      : null
  const surfaceTarget = {
    kind: 'git-worktree' as const,
    workspaceId: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    rootPath: worktreePath,
    head,
    capabilities: workspaceProbe.capabilities,
  }
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
          <FiletreeTab target={surfaceTarget} />
        </WorkspacePanePanelFrame>
      ) : model.selection?.tab === 'terminal' && runtimeTarget ? (
        renderWorkspacePaneRuntimeTabPanel({
          type: 'terminal',
          workspacePaneId,
          panelLabel: { label: t('tab.terminal') },
          target: {
            runtimeTarget,
            presentation: { kind: 'git-worktree', head },
            worktreePath,
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

function GitRepoWorkspaceLoaded({
  repoShell,
  workspacePaneRouteContext,
  workspacePaneId,
  shortcutsEnabled,
  toolbarTrafficLightOffset,
  onBackToBranchNavigator,
}: {
  repoShell: RepoWorkspaceRepoShell
  workspacePaneRouteContext: RepoWorkspacePaneRouteContext
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset: boolean
  onBackToBranchNavigator?: () => void
}) {
  const currentBranchName = repoShell.ui.currentBranchName
  const projectionReadModel = useRepoProjectionReadModel(
    repoShell.id,
    repoShell.workspaceRuntimeId,
    currentBranchName,
    'full',
    true,
  )
  const projection = projectionReadModel.data
  const statusReadModel = useRepoWorktreeStatusReadModel(repoShell.id, repoShell.workspaceRuntimeId, true)
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
              repoShell.id,
              repoShell.workspaceRuntimeId,
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
    return <RepoWorkspaceSkeleton toolbarTrafficLightOffset={toolbarTrafficLightOffset} />
  }
  let presentationBranchModel: RepoWorkspaceRepo['branchModel'] = branchReadModel
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
  const presentationRepo: RepoWorkspaceRepo = {
    ...projectBranchActionRepo(repoShell, projection.operations.operations, currentBranchName),
    branchModel: presentationBranchModel,
    probe: repoShell.probe,
  }
  const statusError = statusReadModel.error
  const statusErrorKey = statusError instanceof Error ? statusError.message : statusError ? String(statusError) : null
  const detailBase = getCurrentRepoWorkspacePresentation(presentationRepo, {
    loading: statusReadModel.isFetching,
    error: statusErrorKey,
    stale: !!statusSnapshot && statusReadModel.isError,
  })
  const detail: CurrentRepoWorkspacePresentation = {
    ...detailBase,
    loading: {
      ...detailBase.loading,
      pullRequests: projectionReadModel.isFetching && !projectionReadModel.dataUpdatedAt,
    },
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      {detail.branch ? (
        <BranchActionWorkspacePane
          repo={presentationRepo}
          detail={detail}
          workspacePaneRouteContext={workspacePaneRouteContext}
          branch={detail.branch}
          workspacePaneId={workspacePaneId}
          shortcutsEnabled={shortcutsEnabled}
          toolbarTrafficLightOffset={toolbarTrafficLightOffset}
          onBackToBranchNavigator={onBackToBranchNavigator}
        />
      ) : (
        <RepoWorkspacePane
          repo={presentationRepo}
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
  repo,
  workspacePaneId,
  toolbarTrafficLightOffset,
  onBackToNavigator,
}: {
  repo: Pick<RepoWorkspaceRepoShell, 'id' | 'workspaceRuntimeId' | 'ui'> & { probe: WorkspaceReadyProbeState }
  workspacePaneId: string
  toolbarTrafficLightOffset: boolean
  onBackToNavigator?: () => void
}) {
  const t = useT()
  const model = useWorkspaceRootTabModel(repo)
  const target = { kind: 'workspace-root' as const, workspaceId: repo.id }
  const runtimeTarget = runtimeWorkspacePaneTarget(target, repo.workspaceRuntimeId)
  const terminalAvailable = repo.probe.capabilities.terminal.available
  const activePanel = model.selection?.tab === 'terminal' && !terminalAvailable ? null : (model.selection?.tab ?? null)
  const overviewReadModel = useWorkspaceDirectoryOverview(repo.id, repo.workspaceRuntimeId, activePanel === 'status')
  const selectedTerminalSessionId =
    model.selection?.kind === 'materialized-tab' && model.selection.materializedTab.kind === 'runtime'
      ? model.selection.materializedTab.sessionId
      : null
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <WorkspacePaneTargetToolbar
        target={{
          kind: 'workspace-root',
          workspaceId: repo.id,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          rootPath: repo.id,
          capabilities: repo.probe.capabilities,
        }}
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
          <FiletreeTab
            target={{
              kind: 'workspace-root',
              workspaceId: repo.id,
              workspaceRuntimeId: repo.workspaceRuntimeId,
              rootPath: repo.id,
              capabilities: repo.probe.capabilities,
            }}
          />
        </WorkspacePanePanelFrame>
      ) : activePanel === 'terminal' && runtimeTarget ? (
        renderWorkspacePaneRuntimeTabPanel({
          type: 'terminal',
          workspacePaneId,
          panelLabel: { label: t('tab.terminal') },
          target: {
            runtimeTarget,
            presentation: { kind: 'workspace-root' },
            worktreePath: repo.id,
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

interface RepoWorkspacePaneProps {
  repo: RepoWorkspaceRepo
  detail: CurrentRepoWorkspacePresentation
  workspacePaneRouteContext: RepoWorkspacePaneRouteContext
  workspacePaneId: string
  toolbarTrafficLightOffset?: boolean
  branchActions?: BranchActions
  onBackToBranchNavigator?: () => void
}

function RepoWorkspacePane({
  repo,
  detail,
  workspacePaneRouteContext,
  workspacePaneId,
  toolbarTrafficLightOffset = false,
  branchActions,
  onBackToBranchNavigator,
}: RepoWorkspacePaneProps) {
  const workspacePaneRoute = workspacePaneRouteContext.kind === 'routed' ? workspacePaneRouteContext.route : undefined
  const routeControllerRoute = workspacePaneRouteContext.kind === 'routed' ? workspacePaneRouteContext.route : null
  const workspacePaneTabModel = useRepoWorkspaceTabModel(repo, detail, workspacePaneRoute)
  useWorkspacePaneVisibleStatusRefresh({
    workspaceId: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    branchName: workspacePaneTabModel.branchName,
    renderedTab: workspacePaneTabModel.renderedTab,
    unavailable: repo.unavailable,
  })
  useWorkspacePaneRouteController({
    enabled: workspacePaneRouteContext.kind === 'routed',
    workspaceId: repo.id,
    branchName: detail.branch?.name ?? null,
    worktreePath: detail.branch?.worktree?.path ?? null,
    route: routeControllerRoute,
    model: workspacePaneTabModel,
  })

  return (
    <>
      <RepoWorkspaceToolbar
        repo={repo}
        detail={detail}
        workspacePaneId={workspacePaneId}
        workspacePaneRoute={workspacePaneRoute}
        trafficLightOffset={toolbarTrafficLightOffset}
        workspacePaneTabModel={workspacePaneTabModel}
        branchActions={branchActions}
        onBackToBranchNavigator={onBackToBranchNavigator}
      />
      <RepoWorkspaceContent
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

interface BranchActionWorkspacePaneProps {
  repo: RepoWorkspaceRepo
  detail: CurrentRepoWorkspacePresentation
  workspacePaneRouteContext: RepoWorkspacePaneRouteContext
  branch: NonNullable<CurrentRepoWorkspacePresentation['branch']>
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset?: boolean
  onBackToBranchNavigator?: () => void
}

function BranchActionWorkspacePane({
  repo,
  detail,
  workspacePaneRouteContext,
  branch,
  workspacePaneId,
  shortcutsEnabled,
  toolbarTrafficLightOffset = false,
  onBackToBranchNavigator,
}: BranchActionWorkspacePaneProps) {
  const workspacePaneRoute = workspacePaneRouteContext.kind === 'routed' ? workspacePaneRouteContext.route : undefined
  const branchActions = useBranchActions(repo, branch)
  const actions = useBranchActionItems(repo, branch, branchActions, { workspacePaneRoute })
  useBranchActionShortcutRegistry(actions, shortcutsEnabled)

  return (
    <BranchActionSurfaceContext value={actions}>
      <RepoWorkspacePane
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
