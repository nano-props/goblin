import { ArrowDown, ArrowUp, GitBranch, GitCompareArrows, GitPullRequest, Workflow } from 'lucide-react'
import { BranchSummaryInline } from '#/web/components/repo-workspace/BranchSummaryInline.tsx'
import { Badge } from '#/web/components/ui/badge.tsx'
import {
  DASHBOARD_CARD_CLASS_NAME,
  DashboardEmptySection,
  DashboardMetricCard,
  DashboardSection,
} from '#/web/components/workspace-pages/dashboard-ui.tsx'
import type { RepoRemoteInfo } from '#/shared/git-types.ts'
import { workspaceNameFromLocator } from '#/shared/workspace-display-location.ts'
import { cn } from '#/web/lib/cn.ts'
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { remoteWorkspaceTarget } from '#/web/stores/workspaces/workspace-guards.ts'
import type {
  DashboardBranchItem,
  DashboardPullRequestState,
  DashboardRepositoryFacts,
  DashboardSummary,
} from '#/web/components/workspace-pages/workspace-dashboard-model.ts'

const DASHBOARD_BRANCH_ROW_CLASS_NAME =
  'w-full px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45'

interface DashboardWorkspaceIdentity {
  id: WorkspaceState['id']
  admission: WorkspaceState['admission']
}

export function DashboardHeader({
  workspace,
  remote,
  currentBranch,
}: {
  workspace: DashboardWorkspaceIdentity
  remote: RepoRemoteInfo
  currentBranch: string
}) {
  const t = useT()
  const remoteState = dashboardRemoteState(remote)
  const displayLocation = formatWorkspaceDisplayLocation(
    workspace.id,
    remoteWorkspaceTarget(workspace.id, workspace.admission.kind === 'remote' ? workspace.admission.lifecycle : null),
  )

  return (
    <div
      className={cn(
        DASHBOARD_CARD_CLASS_NAME,
        'flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between',
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 truncate text-base font-semibold text-foreground">
            {workspaceNameFromLocator(workspace.id)}
          </h1>
          <Badge variant="outline" className="text-muted-foreground">
            {currentBranch || t('dashboard.no-current-branch')}
          </Badge>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground" title={displayLocation}>
          {displayLocation}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={remoteState.variant}>{t(remoteState.labelKey)}</Badge>
      </div>
    </div>
  )
}

function dashboardRemoteState(remote: RepoRemoteInfo): {
  labelKey: string
  variant: 'outline' | 'success' | 'attention'
} {
  if (remote.hasRemotes) return { labelKey: 'dashboard.remote.connected', variant: 'success' }
  return { labelKey: 'dashboard.remote.local-only', variant: 'outline' }
}

export function DashboardStats({
  compact,
  summary,
  pullRequestState,
}: {
  compact: boolean
  summary: DashboardSummary
  pullRequestState: DashboardPullRequestState
}) {
  const t = useT()
  return (
    <div
      className={cn('grid gap-2', compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4')}
    >
      <DashboardMetricCard
        icon={GitBranch}
        label={t('dashboard.metric.branches')}
        value={summary.branchCount}
        detail={t('dashboard.metric.branches-detail', { count: summary.worktreeCount })}
      />
      <DashboardMetricCard
        icon={Workflow}
        label={t('dashboard.metric.worktrees')}
        value={summary.worktreeCount}
        detail={
          summary.dirtyWorktreeCount === undefined
            ? '—'
            : t('dashboard.metric.worktrees-detail', { count: summary.dirtyWorktreeCount })
        }
        tone={(summary.dirtyWorktreeCount ?? 0) > 0 ? 'attention' : 'default'}
      />
      <DashboardMetricCard
        icon={GitCompareArrows}
        label={t('dashboard.metric.sync')}
        value={`${summary.aheadCount}/${summary.behindCount}`}
        detail={t('dashboard.metric.sync-detail')}
        tone={summary.behindCount > 0 ? 'attention' : 'success'}
      />
      <DashboardMetricCard
        icon={GitPullRequest}
        label={t('dashboard.metric.prs')}
        value={
          pullRequestState === 'pending'
            ? t('branch-status.pr.pending')
            : pullRequestState === 'unavailable'
              ? t('branch-status.pr.unavailable')
              : pullRequestState === 'error'
                ? t('branch-status.pr.failed')
                : (summary.openPullRequestCount ?? '—')
        }
        detail={t('dashboard.metric.prs-detail')}
      />
    </div>
  )
}

export function DashboardAttention({
  branchModel,
  summary,
  onSelectBranch,
}: {
  branchModel: DashboardRepositoryFacts
  summary: DashboardSummary
  onSelectBranch?: (branchName: string) => void
}) {
  const t = useT()
  if (summary.attentionBranches.length === 0) return null

  return (
    <DashboardSection title={t('dashboard.attention.title')} description={t('dashboard.attention.description')}>
      <div className="divide-y divide-separator">
        {summary.attentionBranches.map((item) => (
          <BranchAttentionRow
            key={item.branch.name}
            branchModel={branchModel}
            item={item}
            onSelectBranch={onSelectBranch}
          />
        ))}
      </div>
    </DashboardSection>
  )
}

function BranchAttentionRow({
  branchModel,
  item,
  onSelectBranch,
}: {
  branchModel: DashboardRepositoryFacts
  item: DashboardBranchItem
  onSelectBranch?: (branchName: string) => void
}) {
  const { branch } = item
  return (
    <button
      type="button"
      data-testid="dashboard-branch-link"
      className={cn(
        DASHBOARD_BRANCH_ROW_CLASS_NAME,
        'flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between',
        onSelectBranch && 'hover:bg-accent/45',
        !onSelectBranch && 'cursor-default',
      )}
      disabled={!onSelectBranch}
      onClick={() => onSelectBranch?.(branch.name)}
    >
      <BranchSummaryInline repo={{ status: branchModel.status }} branch={branch} />
      <BranchSignals item={item} />
    </button>
  )
}

function BranchSignals({ item }: { item: DashboardBranchItem }) {
  const t = useT()
  const { branch, dirty, pullRequest } = item
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
      {dirty && <Badge variant="attention">{t('branches.dirty')}</Badge>}
      {branch.trackingGone && <Badge variant="attention">{t('branches.gone')}</Badge>}
      {branch.ahead > 0 && <SignalDelta direction="ahead" count={branch.ahead} />}
      {branch.behind > 0 && <SignalDelta direction="behind" count={branch.behind} />}
      {pullRequest?.checks?.failing ? (
        <Badge variant="danger">{t('dashboard.checks-failing', { count: pullRequest.checks.failing })}</Badge>
      ) : null}
    </div>
  )
}

function SignalDelta({ direction, count }: { direction: 'ahead' | 'behind'; count: number }) {
  const t = useT()
  const Icon = direction === 'ahead' ? ArrowUp : ArrowDown
  const labelKey = direction === 'ahead' ? 'branch-status.sync.ahead' : 'branch-status.sync.behind'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 font-mono text-xs',
        direction === 'ahead' ? 'text-success' : 'text-attention',
      )}
      title={t(labelKey, { n: count })}
    >
      <Icon size={11} />
      {count}
    </span>
  )
}

export function DashboardRecentBranches({
  branchModel,
  branches,
  onSelectBranch,
}: {
  branchModel: DashboardRepositoryFacts
  branches: DashboardBranchItem[]
  onSelectBranch?: (branchName: string) => void
}) {
  const t = useT()
  return (
    <DashboardSection title={t('dashboard.recent.title')} description={t('dashboard.recent.description')}>
      {branches.length > 0 ? (
        <div className="divide-y divide-separator">
          {branches.map((item) => (
            <button
              key={item.branch.name}
              type="button"
              data-testid="dashboard-branch-link"
              className={cn(
                DASHBOARD_BRANCH_ROW_CLASS_NAME,
                'block',
                onSelectBranch && 'hover:bg-accent/45',
                !onSelectBranch && 'cursor-default',
              )}
              disabled={!onSelectBranch}
              onClick={() => onSelectBranch?.(item.branch.name)}
            >
              <BranchSummaryInline repo={{ status: branchModel.status }} branch={item.branch} />
              <div
                className="mt-0.5 truncate pl-5 text-[11px] text-muted-foreground"
                title={item.branch.lastCommitMessage}
              >
                {item.branch.lastCommitShortHash} · {item.branch.lastCommitMessage}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <DashboardEmptySection icon={GitBranch} label={t('branches.empty')} />
      )}
    </DashboardSection>
  )
}
