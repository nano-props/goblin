import { LayoutDashboard } from 'lucide-react'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { WorkspacePagePane } from '#/web/components/workspace-pages/WorkspacePagePane.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { useI18nStore, useT } from '#/web/stores/i18n.ts'
import { cn } from '#/web/lib/cn.ts'
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  useRepoPullRequestsReadModel,
  useRepoSnapshotReadModel,
  useRepoWorktreeStatusReadModel,
} from '#/web/repo-queries.ts'
import { useWorkspaceDirectoryOverview } from '#/web/workspace-directory-overview-query.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspaceNameFromLocator } from '#/shared/workspace-display-location.ts'
import type { WorkspaceDirectoryOverview } from '#/shared/workspace-overview.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import {
  RepoReadFailureNotice,
  RepoStatusFailureView,
  RepoStatusStaleNotice,
} from '#/web/components/RepoStatusFailureView.tsx'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
import { DirectoryOverviewContent } from '#/web/components/workspace-pages/DirectoryOverviewContent.tsx'
import { DASHBOARD_CARD_CLASS_NAME } from '#/web/components/workspace-pages/dashboard-ui.tsx'
import { remoteWorkspaceTarget } from '#/web/stores/workspaces/workspace-guards.ts'
import {
  DashboardAttention,
  DashboardHeader,
  DashboardRecentBranches,
  DashboardStats,
} from '#/web/components/workspace-pages/WorkspaceDashboardSections.tsx'
import {
  buildDashboardSummary,
  type DashboardPullRequestState,
} from '#/web/components/workspace-pages/workspace-dashboard-model.ts'

interface WorkspaceDashboardPaneProps {
  workspaceId: WorkspaceId
  compact?: boolean
  trafficLightOffset?: boolean
  onBack?: () => void
  onSelectBranch?: (branchName: string) => void
}

export function WorkspaceDashboardPane({
  workspaceId,
  compact = false,
  trafficLightOffset = false,
  onBack,
  onSelectBranch,
}: WorkspaceDashboardPaneProps) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const workspace = useWorkspacesStore(
    useShallow((s) => {
      const state = s.workspaces[workspaceId]
      return state
        ? {
            id: state.id,
            workspaceRuntimeId: state.workspaceRuntimeId,
            admission: state.admission,
            capability: state.capability,
          }
        : null
    }),
  )
  const directoryWorkspace = workspace?.capability.kind === 'filesystem'
  const gitQueriesEnabled = workspace?.capability.kind === 'git'
  const snapshotReadModel = useRepoSnapshotReadModel(
    workspaceId,
    workspace?.workspaceRuntimeId ?? '',
    gitQueriesEnabled,
  )
  const snapshot = snapshotReadModel.data?.snapshot
  const pullRequestsReadModel = useRepoPullRequestsReadModel(
    workspaceId,
    workspace?.workspaceRuntimeId ?? '',
    { kind: 'repository-summary' },
    gitQueriesEnabled,
  )
  const statusReadModel = useRepoWorktreeStatusReadModel(
    workspaceId,
    workspace?.workspaceRuntimeId ?? '',
    gitQueriesEnabled,
  )
  const overviewReadModel = useWorkspaceDirectoryOverview(
    workspaceId,
    workspace?.workspaceRuntimeId ?? '',
    !!workspace && directoryWorkspace,
  )
  const branchModel = useMemo(
    () => (snapshot ? { snapshot, status: statusReadModel.data?.status } : null),
    [snapshot, statusReadModel.data],
  )
  const pullRequestEntries = pullRequestsReadModel.data?.pullRequests
  const pullRequestState: DashboardPullRequestState = !pullRequestsReadModel.data
    ? pullRequestsReadModel.isError
      ? 'error'
      : 'pending'
    : pullRequestsReadModel.isError
      ? 'stale'
      : pullRequestsReadModel.data.pullRequests === null
        ? 'unavailable'
        : pullRequestsReadModel.data.pullRequests.length === 0
          ? 'empty'
          : 'ready'
  const summary = useMemo(
    () => (branchModel ? buildDashboardSummary(branchModel, pullRequestEntries) : null),
    [branchModel, pullRequestEntries],
  )
  const hasAttentionBranches = !!summary?.attentionBranches.length
  const statusError = statusReadModel.error
  const statusErrorKey = statusError instanceof Error ? statusError.message : String(statusError)
  const statusStale = !!statusReadModel.data && statusReadModel.isError
  const snapshotError = snapshotReadModel.error
  const snapshotErrorKey = snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
  const pullRequestError = pullRequestsReadModel.error
  const pullRequestErrorKey =
    pullRequestError instanceof Error ? pullRequestError.message : pullRequestError ? String(pullRequestError) : null
  const retryStatus = () => {
    if (!workspace) return
    void refreshRepoWorktreeStatus({ get: useWorkspacesStore.getState }, workspace.id, workspace.workspaceRuntimeId)
  }

  return (
    <WorkspacePagePane
      icon={LayoutDashboard}
      label={t('workspace.dashboard')}
      compact={compact}
      trafficLightOffset={trafficLightOffset}
      onBack={onBack}
    >
      <ScrollArea className="min-h-0 flex-1 bg-background">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-5">
          {workspace && directoryWorkspace && overviewReadModel.data ? (
            <DirectoryDashboard workspace={workspace} overview={overviewReadModel.data} compact={compact} />
          ) : workspace && directoryWorkspace && overviewReadModel.isError ? (
            <div className={cn(DASHBOARD_CARD_CLASS_NAME, 'p-4 text-sm text-destructive')}>
              {t('dashboard.directory.read-failed')}
            </div>
          ) : workspace && workspace.capability.kind === 'git' && !snapshot && snapshotReadModel.isError ? (
            <RepoStatusFailureView
              messageKey={snapshotErrorKey || 'error.failed-read-repo'}
              retrying={snapshotReadModel.isFetching}
              onRetry={() => void snapshotReadModel.refetch()}
            />
          ) : workspace && workspace.capability.kind === 'git' && branchModel && summary ? (
            <>
              {snapshotReadModel.isError && (
                <RepoStatusStaleNotice
                  messageKey={snapshotErrorKey || 'error.failed-read-repo'}
                  retrying={snapshotReadModel.isFetching}
                  onRetry={() => void snapshotReadModel.refetch()}
                />
              )}
              {statusReadModel.isError &&
                (statusStale ? (
                  <RepoStatusStaleNotice
                    messageKey={statusErrorKey}
                    retrying={statusReadModel.isFetching}
                    onRetry={retryStatus}
                  />
                ) : (
                  <RepoReadFailureNotice
                    messageKey={statusErrorKey || 'error.failed-read-repo'}
                    retrying={statusReadModel.isFetching}
                    onRetry={retryStatus}
                  />
                ))}
              {pullRequestState === 'error' && (
                <RepoReadFailureNotice
                  messageKey={pullRequestErrorKey || 'error.failed-read-repo'}
                  retrying={pullRequestsReadModel.isFetching}
                  onRetry={() => void pullRequestsReadModel.refetch()}
                />
              )}
              {pullRequestState === 'stale' && pullRequestErrorKey && (
                <RepoStatusStaleNotice
                  messageKey={pullRequestErrorKey}
                  retrying={pullRequestsReadModel.isFetching}
                  onRetry={() => void pullRequestsReadModel.refetch()}
                />
              )}
              <DashboardHeader
                workspace={workspace}
                remote={branchModel.snapshot.remote}
                currentBranch={branchModel.snapshot.current}
              />
              <DashboardStats compact={compact} summary={summary} pullRequestState={pullRequestState} />
              <div
                className={cn(
                  'grid gap-4',
                  compact || !hasAttentionBranches
                    ? 'grid-cols-1'
                    : 'xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]',
                )}
              >
                <DashboardAttention branchModel={branchModel} summary={summary} onSelectBranch={onSelectBranch} />
                <DashboardRecentBranches
                  branchModel={branchModel}
                  branches={summary.recentBranches}
                  onSelectBranch={onSelectBranch}
                />
              </div>
            </>
          ) : (
            <div className={cn(DASHBOARD_CARD_CLASS_NAME, 'p-4 text-sm text-muted-foreground')}>
              {t('dashboard.loading')}
            </div>
          )}
        </div>
      </ScrollArea>
    </WorkspacePagePane>
  )
}

function DirectoryDashboard({
  workspace,
  overview,
  compact,
}: {
  workspace: Pick<WorkspaceState, 'id' | 'admission'>
  overview: WorkspaceDirectoryOverview
  compact: boolean
}) {
  const t = useT()
  const displayLocation = formatWorkspaceDisplayLocation(
    workspace.id,
    remoteWorkspaceTarget(workspace.id, workspace.admission.kind === 'remote' ? workspace.admission.lifecycle : null),
  )
  return (
    <>
      <div className={cn(DASHBOARD_CARD_CLASS_NAME, 'p-4')}>
        <h1 className="truncate text-base font-semibold text-foreground">{workspaceNameFromLocator(workspace.id)}</h1>
        <div className="mt-1 truncate text-xs text-muted-foreground" title={displayLocation}>
          {displayLocation}
        </div>
      </div>
      <DirectoryOverviewContent overview={overview} compact={compact} />
    </>
  )
}
