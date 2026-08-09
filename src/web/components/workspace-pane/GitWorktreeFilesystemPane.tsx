import { computed, defineComponent } from 'vue'
import { gitHead } from '#/shared/git-head.ts'
import type { GitHead } from '#/shared/git-head.ts'
import type { WorkspaceGitReadyProbeState } from '#/shared/workspace-runtime.ts'
import { gitWorktreeWorkspacePaneTabsTarget, runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { GitWorktreeWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { RepoStatusFailureView, RepoStatusStaleNotice } from '#/web/components/RepoStatusFailureView.tsx'
import { WorkspacePaneSkeleton } from '#/web/components/Skeleton.tsx'
import { StatusList } from '#/web/components/StatusList.tsx'
import { WorkspaceFilesystemTabPanel } from '#/web/components/workspace-pane/WorkspaceFilesystemTabPanel.tsx'
import { WorkspacePanePanelFrame } from '#/web/components/workspace-pane/WorkspacePanePanelFrame.tsx'
import { WorkspacePaneTargetToolbar } from '#/web/components/workspace-pane/WorkspacePaneTargetToolbar.tsx'
import type { GitWorkspacePaneShell } from '#/web/components/workspace-pane/workspace-pane-types.ts'
import { useRepoWorktreeStatusReadModel } from '#/web/repo-queries.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import type { WorktreeStatus } from '#/shared/git-types.ts'
import { useFilesystemWorkspacePaneRouteController } from '#/web/workspace-pane/filesystem-workspace-pane-route-controller.ts'
import { gitWorktreePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { renderWorkspacePaneRuntimeTabPanel } from '#/web/workspace-pane/workspace-pane-runtime-tab-panel.tsx'
import { useGitWorktreeWorkspacePaneTabModel } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'
import type { WorkspacePaneRuntimeContext } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'

interface GitWorktreeFilesystemPaneProps {
  repo: GitWorkspacePaneShell
  workspaceProbe: WorkspaceGitReadyProbeState
  worktreePath: string
  route: ParsedWorkspacePaneRoute | null
  workspacePaneId: string
  toolbarTrafficLightOffset: boolean
  onBackToNavigator?: () => void
}

export const GitWorktreeFilesystemPane = defineComponent<GitWorktreeFilesystemPaneProps>({
  name: 'GitWorktreeFilesystemPane',
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
    const statusReadModel = useRepoWorktreeStatusReadModel(
      () => props.repo.id,
      () => props.repo.workspaceRuntimeId,
    )
    const worktree = computed(() =>
      statusReadModel.data.value?.status.find((candidate) => candidate.path === props.worktreePath),
    )
    const target = computed(() => gitWorktreeWorkspacePaneTabsTarget(props.repo.id, props.worktreePath))

    return () => {
      if (!statusReadModel.data.value && statusReadModel.isPending.value) {
        return <WorkspacePaneSkeleton toolbarTrafficLightOffset={props.toolbarTrafficLightOffset} />
      }
      if (!statusReadModel.data.value && statusReadModel.isError.value) {
        const error = statusReadModel.error.value
        return (
          <RepoStatusFailureView
            messageKey={error instanceof Error ? error.message : String(error)}
            retrying={statusReadModel.isFetching.value}
            onRetry={() => void statusReadModel.refetch()}
          />
        )
      }
      const currentTarget = target.value
      const currentWorktree = worktree.value
      if (!currentTarget || !currentWorktree) {
        return <EmptyState title={t('workspace-route.not-found-title')} />
      }
      const statusError = statusReadModel.isError.value
        ? statusReadModel.error.value instanceof Error
          ? statusReadModel.error.value.message
          : String(statusReadModel.error.value)
        : null
      return (
        <GitWorktreeFilesystemPaneReady
          workspaceRuntime={{ workspaceRuntimeId: props.repo.workspaceRuntimeId, ui: props.repo.ui }}
          workspaceProbe={props.workspaceProbe}
          head={gitHead(currentWorktree.branch ?? null)}
          status={currentWorktree}
          statusError={statusError}
          statusRetrying={statusReadModel.isFetching.value}
          onRetryStatus={() => void statusReadModel.refetch()}
          target={currentTarget}
          route={props.route}
          workspacePaneId={props.workspacePaneId}
          toolbarTrafficLightOffset={props.toolbarTrafficLightOffset}
          onBackToNavigator={props.onBackToNavigator}
        />
      )
    }
  },
})

interface GitWorktreeFilesystemPaneReadyProps {
  workspaceRuntime: WorkspacePaneRuntimeContext
  workspaceProbe: WorkspaceGitReadyProbeState
  head: GitHead
  status: WorktreeStatus
  statusError: string | null
  statusRetrying: boolean
  onRetryStatus: () => void
  target: GitWorktreeWorkspacePaneTabsTarget
  route: ParsedWorkspacePaneRoute | null
  workspacePaneId: string
  toolbarTrafficLightOffset: boolean
  onBackToNavigator?: () => void
}

const GitWorktreeFilesystemPaneReady = defineComponent<GitWorktreeFilesystemPaneReadyProps>({
  name: 'GitWorktreeFilesystemPaneReady',
  props: [
    'workspaceRuntime',
    'workspaceProbe',
    'head',
    'status',
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
    const model = useGitWorktreeWorkspacePaneTabModel(
      () => props.workspaceRuntime,
      () => props.target,
      () => props.head,
      () => props.route,
    )
    useFilesystemWorkspacePaneRouteController({ route: () => props.route, model })
    const runtimeTarget = computed(() =>
      runtimeWorkspacePaneTarget(props.target, props.workspaceRuntime.workspaceRuntimeId),
    )
    const surfaceTarget = computed(() =>
      gitWorktreePaneFilesystemTarget({
        workspaceId: props.target.workspaceId,
        workspaceRuntimeId: props.workspaceRuntime.workspaceRuntimeId,
        worktreePath: props.target.worktreePath,
        head: props.head,
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

      return (
        <section class="flex min-h-0 flex-1 flex-col bg-background" data-testid="detached-worktree-pane">
          {props.statusError ? (
            <RepoStatusStaleNotice
              messageKey={props.statusError}
              retrying={props.statusRetrying}
              onRetry={props.onRetryStatus}
            />
          ) : null}
          <WorkspacePaneTargetToolbar
            target={surfaceTarget.value}
            model={currentModel}
            workspacePaneId={props.workspacePaneId}
            workspacePaneRoute={props.route}
            statusCount={props.status.entries.length}
            trafficLightOffset={props.toolbarTrafficLightOffset}
            onBackToNavigator={props.onBackToNavigator}
            staticTabAvailable={(type) => type === 'status' || type === 'files'}
          />
          {selection?.tab === 'status' ? (
            <WorkspacePanePanelFrame id={`${props.workspacePaneId}-status-panel`} label={t('tab.status')}>
              <ScrollPane>
                <StatusList status={[props.status]} />
              </ScrollPane>
            </WorkspacePanePanelFrame>
          ) : selection?.tab === 'files' ? (
            <WorkspacePanePanelFrame id={`${props.workspacePaneId}-files-panel`} label={t('tab.files')}>
              <WorkspaceFilesystemTabPanel routeTarget={props.target} target={surfaceTarget.value} />
            </WorkspacePanePanelFrame>
          ) : selection?.tab === 'terminal' && runtimeTarget.value ? (
            renderWorkspacePaneRuntimeTabPanel({
              type: 'terminal',
              workspacePaneId: props.workspacePaneId,
              panelLabel: { label: t('tab.terminal') },
              target: {
                routeTarget: props.target,
                runtimeTarget: runtimeTarget.value,
                presentation: { kind: 'git-worktree', head: props.head },
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
