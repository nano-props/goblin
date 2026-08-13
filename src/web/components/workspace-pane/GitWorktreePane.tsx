import { computed, defineComponent } from 'vue'
import type { WorkspaceGitReadyProbeState } from '#/shared/workspace-runtime.ts'
import { gitWorktreeWorkspacePaneTabsTarget, runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { GitWorktreeWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import {
  RepoReadFailureNotice,
  RepoStatusFailureView,
  RepoStatusStaleNotice,
} from '#/web/components/RepoStatusFailureView.tsx'
import { RepoReadNotice } from '#/web/components/RepoReadNotice.tsx'
import { WorkspacePaneSkeleton } from '#/web/components/Skeleton.tsx'
import { StatusList } from '#/web/components/StatusList.tsx'
import { WorkspaceFilesystemTabPanel } from '#/web/components/workspace-pane/WorkspaceFilesystemTabPanel.tsx'
import { WorkspacePanePanelFrame } from '#/web/components/workspace-pane/WorkspacePanePanelFrame.tsx'
import { WorkspacePaneTargetToolbar } from '#/web/components/workspace-pane/WorkspacePaneTargetToolbar.tsx'
import { WorktreeStatusOverview } from '#/web/components/workspace-pane/WorktreeStatusOverview.tsx'
import { EmptyGitHistoryPanel, GitHistoryPanel } from '#/web/components/repo-workspace/GitHistoryPanel.tsx'
import { GitWorkspacePane } from '#/web/components/workspace-pane/GitWorkspacePane.tsx'
import type { GitWorkspacePaneShell } from '#/web/components/workspace-pane/workspace-pane-types.ts'
import { useRepoSnapshotReadModel, useRepoWorktreeStatusReadModel } from '#/web/repo-queries.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import type { RepoWorktreeSnapshot, WorktreeStatus } from '#/shared/git-types.ts'
import { useFilesystemWorkspacePaneRouteController } from '#/web/workspace-pane/filesystem-workspace-pane-route-controller.ts'
import { gitWorktreePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { renderWorkspacePaneRuntimeTabPanel } from '#/web/workspace-pane/workspace-pane-runtime-tab-panel.tsx'
import { useGitWorktreeWorkspacePaneTabModel } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'
import type { WorkspacePaneRuntimeContext } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'
import { repoQueryReadFailure } from '#/web/repo-read-failure.ts'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { dispatchOpenWorkspacePaneTargetStaticTabAction } from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'

interface GitWorktreePaneProps {
  repo: GitWorkspacePaneShell
  workspaceProbe: WorkspaceGitReadyProbeState
  worktreePath: string
  route: ParsedWorkspacePaneRoute | null
  workspacePaneId: string
  toolbarTrafficLightOffset: boolean
  onBackToNavigator?: () => void
}

export const GitWorktreePane = defineComponent<GitWorktreePaneProps>({
  name: 'GitWorktreePane',
  props: [
    'repo',
    'workspaceProbe',
    'worktreePath',
    'route',
    'workspacePaneId',
    'toolbarTrafficLightOffset',
    'onBackToNavigator',
  ],

  setup(props) {
    const t = useT()
    const snapshotReadModel = useRepoSnapshotReadModel(
      () => props.repo.id,
      () => props.repo.workspaceRuntimeId,
    )
    const statusReadModel = useRepoWorktreeStatusReadModel(
      () => props.repo.id,
      () => props.repo.workspaceRuntimeId,
    )
    const worktreeStatus = computed(() =>
      statusReadModel.data.value?.status.find((candidate) => candidate.path === props.worktreePath),
    )
    const worktree = computed(() =>
      snapshotReadModel.data.value?.snapshot.worktrees.find((candidate) => candidate.path === props.worktreePath),
    )
    const target = computed(() => gitWorktreeWorkspacePaneTabsTarget(props.repo.id, props.worktreePath))

    return () => {
      if (!snapshotReadModel.data.value && snapshotReadModel.isPending.value) {
        return <WorkspacePaneSkeleton toolbarTrafficLightOffset={props.toolbarTrafficLightOffset} />
      }
      if (!snapshotReadModel.data.value && snapshotReadModel.isError.value) {
        const error = snapshotReadModel.error.value
        return (
          <RepoStatusFailureView
            messageKey={error instanceof Error ? error.message : String(error)}
            retrying={snapshotReadModel.isFetching.value}
            onRetry={() => void snapshotReadModel.refetch()}
          />
        )
      }
      const currentTarget = target.value
      const currentWorktree = worktree.value
      if (!currentTarget || !currentWorktree) {
        return <EmptyState title={t('workspace-route.not-found-title')} />
      }
      const attachedBranchName = currentWorktree.head.kind === 'branch' ? currentWorktree.head.branchName : null
      const attachedBranch = attachedBranchName
        ? snapshotReadModel.data.value?.snapshot.branches.find((branch) => branch.name === attachedBranchName)
        : null
      if (attachedBranch && currentWorktree.operation === null) {
        return (
          <GitWorkspacePane
            gitWorkspace={{
              ...props.repo,
              ui: { ...props.repo.ui, currentBranchName: attachedBranch.name },
            }}
            workspacePaneRouteContext={{ kind: 'git-worktree', worktreePath: props.worktreePath, route: props.route }}
            workspacePaneId={props.workspacePaneId}
            shortcutsEnabled
            toolbarTrafficLightOffset={props.toolbarTrafficLightOffset}
            onBackToGitWorkspaceNavigator={props.onBackToNavigator}
          />
        )
      }
      const currentWorktreeStatus = worktreeStatus.value
      const statusError = statusReadModel.isError.value
        ? statusReadModel.error.value instanceof Error
          ? statusReadModel.error.value.message
          : String(statusReadModel.error.value)
        : null
      const snapshotFailure = repoQueryReadFailure(
        {
          isError: snapshotReadModel.isError.value,
          error: snapshotReadModel.error.value,
          isFetching: snapshotReadModel.isFetching.value,
          data: snapshotReadModel.data.value,
        },
        () => void snapshotReadModel.refetch(),
      )
      return (
        <>
          <RepoReadNotice failures={snapshotFailure ? [snapshotFailure] : []} />
          <GitWorktreePaneReady
            workspaceRuntime={{ workspaceRuntimeId: props.repo.workspaceRuntimeId, ui: props.repo.ui }}
            workspaceProbe={props.workspaceProbe}
            worktree={currentWorktree}
            status={currentWorktreeStatus}
            statusPending={!statusReadModel.data.value && statusReadModel.isPending.value}
            statusError={statusError}
            statusRetrying={statusReadModel.isFetching.value}
            onRetryStatus={() => void statusReadModel.refetch()}
            target={currentTarget}
            route={props.route}
            workspacePaneId={props.workspacePaneId}
            toolbarTrafficLightOffset={props.toolbarTrafficLightOffset}
            onBackToNavigator={props.onBackToNavigator}
          />
        </>
      )
    }
  },
})

interface GitWorktreePaneReadyProps {
  workspaceRuntime: WorkspacePaneRuntimeContext
  workspaceProbe: WorkspaceGitReadyProbeState
  worktree: RepoWorktreeSnapshot
  status?: WorktreeStatus
  statusPending: boolean
  statusError: string | null
  statusRetrying: boolean
  onRetryStatus: () => void
  target: GitWorktreeWorkspacePaneTabsTarget
  route: ParsedWorkspacePaneRoute | null
  workspacePaneId: string
  toolbarTrafficLightOffset: boolean
  onBackToNavigator?: () => void
}

const GitWorktreePaneReady = defineComponent<GitWorktreePaneReadyProps>({
  name: 'GitWorktreePaneReady',
  props: [
    'workspaceRuntime',
    'workspaceProbe',
    'worktree',
    'status',
    'statusPending',
    'statusError',
    'statusRetrying',
    'onRetryStatus',
    'target',
    'route',
    'workspacePaneId',
    'toolbarTrafficLightOffset',
    'onBackToNavigator',
  ],

  setup(props) {
    const t = useT()
    const navigation = useAppNavigation()
    const model = useGitWorktreeWorkspacePaneTabModel(
      () => props.workspaceRuntime,
      () => props.target,
      () => props.worktree.head,
      () => props.route,
    )
    const routeReconciliation = useFilesystemWorkspacePaneRouteController({ route: () => props.route, model })
    const runtimeTarget = computed(() =>
      runtimeWorkspacePaneTarget(props.target, props.workspaceRuntime.workspaceRuntimeId),
    )
    const surfaceTarget = computed(() =>
      gitWorktreePaneFilesystemTarget({
        workspaceId: props.target.workspaceId,
        workspaceRuntimeId: props.workspaceRuntime.workspaceRuntimeId,
        worktreePath: props.target.worktreePath,
        head: props.worktree.head,
        capabilities: props.workspaceProbe.capabilities,
      }),
    )

    return () => {
      const currentModel = model.value
      const selection = currentModel.selection
      const selectedTerminalSessionId =
        selection?.kind === 'materialized-tab' && selection.materializedTab.kind === 'runtime'
          ? selection.materializedTab.sessionId
          : null
      const routeMissing = routeReconciliation.value.kind === 'missing'
      const openStaticTab = (type: 'changes' | 'history') => {
        void dispatchOpenWorkspacePaneTargetStaticTabAction({
          workspaceId: props.target.workspaceId,
          workspaceRuntimeId: props.workspaceRuntime.workspaceRuntimeId,
          routeTarget: props.target,
          paneTarget: props.target,
          worktreeHead: props.worktree.head,
          type,
          workspacePaneRoute: props.route,
          navigation,
        })
      }

      return (
        <section class="flex min-h-0 flex-1 flex-col bg-background" data-testid="worktree-pane">
          <WorkspacePaneTargetToolbar
            target={surfaceTarget.value}
            model={currentModel}
            workspacePaneId={props.workspacePaneId}
            workspacePaneRoute={props.route}
            statusCount={props.status?.entries.length}
            trafficLightOffset={props.toolbarTrafficLightOffset}
            onBackToNavigator={props.onBackToNavigator}
            staticTabAvailable={(type) =>
              type === 'status' || type === 'changes' || type === 'history' || type === 'files'
            }
          />
          {routeMissing ? (
            <EmptyState title={t('workspace-route.not-found-title')} />
          ) : selection?.tab === 'status' ? (
            <WorkspacePanePanelFrame id={`${props.workspacePaneId}-status-panel`} label={t('tab.status')}>
              {props.statusError ? (
                props.status ? (
                  <RepoStatusStaleNotice
                    messageKey={props.statusError}
                    retrying={props.statusRetrying}
                    onRetry={props.onRetryStatus}
                  />
                ) : (
                  <RepoReadFailureNotice
                    messageKey={props.statusError}
                    retrying={props.statusRetrying}
                    onRetry={props.onRetryStatus}
                  />
                )
              ) : null}
              <ScrollPane>
                <WorktreeStatusOverview
                  worktree={props.worktree}
                  status={props.status}
                  statusPending={props.statusPending}
                  statusUnavailable={!props.status && !props.statusPending}
                  onOpenChanges={() => openStaticTab('changes')}
                  onOpenHistory={() => openStaticTab('history')}
                />
              </ScrollPane>
            </WorkspacePanePanelFrame>
          ) : selection?.tab === 'changes' ? (
            <WorkspacePanePanelFrame id={`${props.workspacePaneId}-changes-panel`} label={t('tab.changes')}>
              {props.status && props.statusError ? (
                <RepoStatusStaleNotice
                  messageKey={props.statusError}
                  retrying={props.statusRetrying}
                  onRetry={props.onRetryStatus}
                />
              ) : null}
              {props.status ? (
                <ScrollPane>
                  <StatusList status={[props.status]} />
                </ScrollPane>
              ) : props.statusPending ? (
                <div class="min-h-0 flex-1" aria-busy="true" />
              ) : (
                <RepoStatusFailureView
                  messageKey={props.statusError ?? 'error.failed-read-repo'}
                  retrying={props.statusRetrying}
                  onRetry={props.onRetryStatus}
                />
              )}
            </WorkspacePanePanelFrame>
          ) : selection?.tab === 'history' ? (
            props.worktree.headOid ? (
              <GitHistoryPanel
                repoId={props.target.workspaceId}
                workspaceRuntimeId={props.workspaceRuntime.workspaceRuntimeId}
                target={{ kind: 'commit', oid: props.worktree.headOid }}
                workspacePaneId={props.workspacePaneId}
                panelLabel={{ label: t('tab.log') }}
              />
            ) : (
              <EmptyGitHistoryPanel workspacePaneId={props.workspacePaneId} panelLabel={{ label: t('tab.log') }} />
            )
          ) : selection?.tab === 'files' ? (
            <WorkspacePanePanelFrame id={`${props.workspacePaneId}-files-panel`} label={t('tab.files')}>
              <WorkspaceFilesystemTabPanel target={surfaceTarget.value} />
            </WorkspacePanePanelFrame>
          ) : selection?.tab === 'terminal' && runtimeTarget.value ? (
            renderWorkspacePaneRuntimeTabPanel({
              type: 'terminal',
              workspacePaneId: props.workspacePaneId,
              panelLabel: { label: t('tab.terminal') },
              target: {
                runtimeTarget: runtimeTarget.value,
                presentation: { kind: 'git-worktree' },
              },
              selectedSessionId: selectedTerminalSessionId,
              runtimeState: currentModel.runtimeTabStateByType.terminal,
            })
          ) : (
            <EmptyState title={t('workspace-pane-tabs.empty')} />
          )}
        </section>
      )
    }
  },
})
