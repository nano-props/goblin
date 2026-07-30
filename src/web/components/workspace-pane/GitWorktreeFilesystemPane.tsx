import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { RepoStatusFailureView, RepoStatusStaleNotice } from '#/web/components/RepoStatusFailureView.tsx'
import { WorkspacePaneSkeleton } from '#/web/components/Skeleton.tsx'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { StatusList } from '#/web/components/StatusList.tsx'
import { WorkspaceFilesystemTabPanel } from '#/web/components/workspace-pane/WorkspaceFilesystemTabPanel.tsx'
import { WorkspacePanePanelFrame } from '#/web/components/workspace-pane/WorkspacePanePanelFrame.tsx'
import { WorkspacePaneTargetToolbar } from '#/web/components/workspace-pane/WorkspacePaneTargetToolbar.tsx'
import type { GitWorkspacePaneShell } from '#/web/components/workspace-pane/workspace-pane-types.ts'
import { gitHead, type GitHead } from '#/shared/git-head.ts'
import type { WorkspaceGitReadyProbeState } from '#/shared/workspace-runtime.ts'
import {
  gitWorktreeWorkspacePaneTabsTarget,
  runtimeWorkspacePaneTarget,
  type GitWorktreeWorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import { useRepoWorktreeStatusReadModel } from '#/web/repo-queries.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { WorktreeStatus } from '#/web/types.ts'
import { gitWorktreePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { renderWorkspacePaneRuntimeTabPanel } from '#/web/workspace-pane/workspace-pane-runtime-tab-panel.tsx'
import { useFilesystemWorkspacePaneRouteController } from '#/web/workspace-pane/filesystem-workspace-pane-route-controller.ts'
import {
  useGitWorktreeWorkspacePaneTabModel,
  type WorkspacePaneRuntimeContext,
} from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'

export function GitWorktreeFilesystemPane({
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
  if (!statusReadModel.data && statusReadModel.isPending) {
    return <WorkspacePaneSkeleton toolbarTrafficLightOffset={toolbarTrafficLightOffset} />
  }
  if (!statusReadModel.data && statusReadModel.isError) {
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
      statusError={
        statusReadModel.isError
          ? statusReadModel.error instanceof Error
            ? statusReadModel.error.message
            : String(statusReadModel.error)
          : null
      }
      statusRetrying={statusReadModel.isFetching}
      onRetryStatus={() => void statusReadModel.refetch()}
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
  statusError,
  statusRetrying,
  onRetryStatus,
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
  statusError: string | null
  statusRetrying: boolean
  onRetryStatus: () => void
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
      {statusError && (
        <RepoStatusStaleNotice messageKey={statusError} retrying={statusRetrying} onRetry={onRetryStatus} />
      )}
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
