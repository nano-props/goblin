import {
  ArrowDown,
  ArrowUp,
  GitBranch,
  GitCompareArrows,
  GitPullRequest,
  LayoutDashboard,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { RepoPagePane } from '#/web/components/repo-pages/RepoPagePane.tsx'
import { Badge } from '#/web/components/ui/badge.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { BranchSummaryInline } from '#/web/components/repo-workspace/BranchSummaryInline.tsx'
import { useI18nStore, useT, type Lang } from '#/web/stores/i18n.ts'
import { formatRelativeTimeOrNull } from '#/web/lib/dates.ts'
import { cn } from '#/web/lib/cn.ts'
import { tildify } from '#/web/lib/paths.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { repoBranchReadModelFromSnapshot, type RepoBranchReadModelData } from '#/web/repo-branch-read-model.ts'
import { useRepoProjectionReadModel, useRepoWorktreeStatusReadModel } from '#/web/repo-data-query.ts'
import type { PullRequestEntry } from '#/shared/api-types.ts'
import type { RepoBranchState, RepoState } from '#/web/stores/repos/types.ts'
import { RepoStatusFailureView } from '#/web/components/RepoStatusFailureView.tsx'
import { refreshVisibleStatusCache } from '#/web/stores/repos/visible-status-refresh.ts'

type DashboardTone = 'default' | 'attention' | 'success'

const DASHBOARD_CARD_CLASS_NAME = 'rounded-lg border border-border/60 bg-card shadow-[var(--shadow-inset-highlight)]'
const DASHBOARD_BRANCH_ROW_CLASS_NAME =
  'w-full px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45'

interface DashboardBranchItem {
  branch: RepoBranchState
  dirty: boolean
  pullRequest?: PullRequestEntry['pullRequest']
}

interface DashboardSummary {
  branchCount: number
  worktreeCount: number
  dirtyWorktreeCount: number
  aheadCount: number
  behindCount: number
  openPullRequestCount: number
  attentionBranches: DashboardBranchItem[]
  recentBranches: DashboardBranchItem[]
}

interface RepoDashboardPaneProps {
  repoId: string
  compact?: boolean
  trafficLightOffset?: boolean
  onBack?: () => void
  onSelectBranch?: (branchName: string) => void
}

export function RepoDashboardPane({
  repoId,
  compact = false,
  trafficLightOffset = false,
  onBack,
  onSelectBranch,
}: RepoDashboardPaneProps) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const repo = useReposStore(
    useShallow((s) => {
      const state = s.repos[repoId]
      return state
        ? {
            id: state.id,
            name: state.name,
            repoRuntimeId: state.repoRuntimeId,
            projection: state.projection,
            remote: state.remote,
          }
        : null
    }),
  )
  const projectionReadModel = useRepoProjectionReadModel(repoId, repo?.repoRuntimeId ?? '', null, 'summary', !!repo)
  const projection = projectionReadModel.data
  const statusReadModel = useRepoWorktreeStatusReadModel(repoId, repo?.repoRuntimeId ?? '', !!repo)
  const branchModel = useMemo(
    () =>
      projection?.snapshot && statusReadModel.data
        ? repoBranchReadModelFromSnapshot(projection.snapshot, statusReadModel.data.status)
        : null,
    [projection?.snapshot, statusReadModel.data],
  )
  const pullRequestEntries = projection?.pullRequests ?? null
  const summary = useMemo(
    () => (branchModel ? buildDashboardSummary(branchModel, pullRequestEntries) : null),
    [branchModel, pullRequestEntries],
  )
  const hasAttentionBranches = !!summary?.attentionBranches.length
  const statusError = statusReadModel.error
  const statusErrorMessage = statusError instanceof Error ? statusError.message : String(statusError)

  return (
    <RepoPagePane
      icon={LayoutDashboard}
      label={t('repo.dashboard')}
      compact={compact}
      trafficLightOffset={trafficLightOffset}
      onBack={onBack}
    >
      <ScrollArea className="min-h-0 flex-1 bg-background">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-5">
          {repo && projection?.snapshot && !statusReadModel.data && statusReadModel.isError ? (
            <RepoStatusFailureView
              message={statusErrorMessage}
              retrying={statusReadModel.isFetching}
              onRetry={() => {
                void refreshVisibleStatusCache(
                  { get: useReposStore.getState, set: useReposStore.setState },
                  repo.id,
                  repo.repoRuntimeId,
                )
              }}
            />
          ) : repo && branchModel && summary ? (
            <>
              <DashboardHeader repo={repo} currentBranch={branchModel.currentBranch} lang={lang} />
              <DashboardStats compact={compact} summary={summary} />
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
    </RepoPagePane>
  )
}

function buildDashboardSummary(
  branchModel: RepoBranchReadModelData,
  pullRequestEntries: PullRequestEntry[] | null,
): DashboardSummary {
  const branches = branchModel.branches
  const pullRequestsByBranch = new Map(pullRequestEntries?.map((entry) => [entry.branch, entry.pullRequest]) ?? [])
  const branchItems = branches.map((branch) => buildDashboardBranchItem(branchModel, pullRequestsByBranch, branch))
  const worktreeBranches = branchItems.filter(({ branch }) => !!branch.worktree?.path)
  const dirtyWorktreeCount = worktreeBranches.filter((item) => item.dirty).length
  const aheadCount = branches.filter((branch) => branch.ahead > 0).length
  const behindCount = branches.filter((branch) => branch.behind > 0).length
  const openPullRequestCount = [...pullRequestsByBranch.values()].filter(
    (pullRequest) => pullRequest.state === 'open',
  ).length
  const attentionBranches = branchItems
    .filter(
      ({ branch, dirty, pullRequest }) =>
        !!branch.trackingGone || branch.behind > 0 || branch.ahead > 0 || dirty || pullRequest?.checks?.failing,
    )
    .sort(compareBranchesForAttention)
    .slice(0, 6)
  const recentBranches = [...branchItems].sort(compareBranchesByCommitDate).slice(0, 8)

  return {
    branchCount: branches.length,
    worktreeCount: worktreeBranches.length,
    dirtyWorktreeCount,
    aheadCount,
    behindCount,
    openPullRequestCount,
    attentionBranches,
    recentBranches,
  }
}

function buildDashboardBranchItem(
  branchModel: RepoBranchReadModelData,
  pullRequestsByBranch: Map<string, PullRequestEntry['pullRequest']>,
  branch: RepoBranchState,
): DashboardBranchItem {
  return {
    branch,
    dirty: branchWorktreeDirty(branchModel, branch),
    pullRequest: pullRequestsByBranch.get(branch.name),
  }
}

function compareBranchesByCommitDate(a: DashboardBranchItem, b: DashboardBranchItem) {
  return Date.parse(b.branch.lastCommitDate) - Date.parse(a.branch.lastCommitDate)
}

function compareBranchesForAttention(a: DashboardBranchItem, b: DashboardBranchItem) {
  return branchAttentionScore(b) - branchAttentionScore(a) || compareBranchesByCommitDate(a, b)
}

function branchAttentionScore({ branch, dirty, pullRequest }: DashboardBranchItem) {
  return (
    (branch.trackingGone ? 100 : 0) +
    (dirty ? 40 : 0) +
    Math.min(branch.behind, 20) * 3 +
    Math.min(branch.ahead, 20) * 2 +
    (pullRequest?.checks?.failing ?? 0) * 8
  )
}

function branchWorktreeDirty(branchModel: RepoBranchReadModelData, branch: RepoBranchState) {
  const worktreePath = branch.worktree?.path
  if (!worktreePath) return false
  const status = branchModel.status.find((wt) => wt.path === worktreePath)
  if (status) return status.entries.length > 0
  return branchModel.worktreesByPath[worktreePath]?.isDirty ?? false
}

function DashboardHeader({
  repo,
  currentBranch,
  lang,
}: {
  repo: Pick<RepoState, 'name' | 'id' | 'projection' | 'remote'>
  currentBranch: string
  lang: Lang
}) {
  const t = useT()
  const updatedAt = repo.projection.savedAt
    ? formatRelativeTimeOrNull(new Date(repo.projection.savedAt).toISOString(), lang)
    : null
  const remoteState = dashboardRemoteState(repo)

  return (
    <div
      className={cn(
        DASHBOARD_CARD_CLASS_NAME,
        'flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between',
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 truncate text-base font-semibold text-foreground">{repo.name}</h1>
          <Badge variant="outline" className="text-muted-foreground">
            {currentBranch || t('dashboard.no-current-branch')}
          </Badge>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground" title={repo.id}>
          {tildify(repo.id)}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={remoteState.variant}>{t(remoteState.labelKey)}</Badge>
        {updatedAt && <span>{t('dashboard.updated', { time: updatedAt })}</span>}
      </div>
    </div>
  )
}

function dashboardRemoteState(repo: Pick<RepoState, 'remote'>): {
  labelKey: string
  variant: 'outline' | 'success' | 'attention'
} {
  if (repo.remote.fetchFailed) return { labelKey: 'dashboard.remote.fetch-failed', variant: 'attention' }
  if (repo.remote.hasRemotes) return { labelKey: 'dashboard.remote.connected', variant: 'success' }
  return { labelKey: 'dashboard.remote.local-only', variant: 'outline' }
}

function DashboardStats({ compact, summary }: { compact: boolean; summary: DashboardSummary }) {
  const t = useT()
  return (
    <div
      className={cn('grid gap-2', compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4')}
    >
      <MetricCard
        icon={GitBranch}
        label={t('dashboard.metric.branches')}
        value={summary.branchCount}
        detail={t('dashboard.metric.branches-detail', { count: summary.worktreeCount })}
      />
      <MetricCard
        icon={Workflow}
        label={t('dashboard.metric.worktrees')}
        value={summary.worktreeCount}
        detail={t('dashboard.metric.worktrees-detail', { count: summary.dirtyWorktreeCount })}
        tone={summary.dirtyWorktreeCount > 0 ? 'attention' : 'default'}
      />
      <MetricCard
        icon={GitCompareArrows}
        label={t('dashboard.metric.sync')}
        value={`${summary.aheadCount}/${summary.behindCount}`}
        detail={t('dashboard.metric.sync-detail')}
        tone={summary.behindCount > 0 ? 'attention' : 'success'}
      />
      <MetricCard
        icon={GitPullRequest}
        label={t('dashboard.metric.prs')}
        value={summary.openPullRequestCount}
        detail={t('dashboard.metric.prs-detail')}
      />
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: LucideIcon
  label: string
  value: string | number
  detail: string
  tone?: DashboardTone
}) {
  return (
    <div className={cn(DASHBOARD_CARD_CLASS_NAME, 'flex min-h-14 items-center gap-2 px-2.5 py-2')}>
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/45">
        <Icon size={14} className={metricToneClass(tone)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
          <div className="shrink-0 text-lg font-semibold leading-none text-foreground">{value}</div>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{detail}</div>
      </div>
    </div>
  )
}

function metricToneClass(tone: DashboardTone) {
  if (tone === 'attention') return 'text-attention'
  if (tone === 'success') return 'text-success'
  return 'text-brand-text'
}

function DashboardAttention({
  branchModel,
  summary,
  onSelectBranch,
}: {
  branchModel: RepoBranchReadModelData
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
  branchModel: RepoBranchReadModelData
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
      <BranchSummaryInline repo={{ branchModel }} branch={branch} />
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

function DashboardRecentBranches({
  branchModel,
  branches,
  onSelectBranch,
}: {
  branchModel: RepoBranchReadModelData
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
              <BranchSummaryInline repo={{ branchModel }} branch={item.branch} />
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
        <EmptySection icon={GitBranch} label={t('branches.empty')} />
      )}
    </DashboardSection>
  )
}

function DashboardSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className={cn(DASHBOARD_CARD_CLASS_NAME, 'overflow-hidden')}>
      <div className="flex min-w-0 flex-col gap-0.5 border-b border-separator px-3 py-2.5 sm:flex-row sm:items-baseline sm:gap-2">
        <h2 className="shrink-0 text-[13px] font-semibold text-foreground">{title}</h2>
        <div className="min-w-0 truncate text-[11px] text-muted-foreground">{description}</div>
      </div>
      {children}
    </section>
  )
}

function EmptySection({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center gap-2 px-4 py-6 text-center text-sm text-muted-foreground">
      <Icon size={16} />
      <span>{label}</span>
    </div>
  )
}
