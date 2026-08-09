import { ArrowDown, ArrowUp, GitBranch, GitCompareArrows, GitPullRequest, Workflow } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { FunctionalComponent } from 'vue'
import type { RepoRemoteInfo } from '#/shared/git-types.ts'
import { workspaceNameFromLocator } from '#/shared/workspace-display-location.ts'
import { BranchSummaryInline } from '#/web/components/repo-workspace/BranchSummaryInline.tsx'
import { Badge } from '#/web/components/ui/badge.tsx'
import {
  DASHBOARD_CARD_CLASS,
  DashboardEmptySection,
  DashboardMetricCard,
  DashboardSection,
} from '#/web/components/workspace-pages/dashboard-ui.tsx'
import type {
  DashboardBranchItem,
  DashboardPullRequestState,
  DashboardRepositoryFacts,
  DashboardSummary,
} from '#/web/components/workspace-pages/workspace-dashboard-model.ts'
import { cn } from '#/web/lib/cn.ts'
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { remoteWorkspaceTarget } from '#/web/stores/workspaces/workspace-guards.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'

const DASHBOARD_BRANCH_ROW_CLASS =
  'w-full px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45'

interface DashboardWorkspaceIdentity {
  id: WorkspaceState['id']
  admission: WorkspaceState['admission']
}

interface DashboardHeaderProps {
  workspace: DashboardWorkspaceIdentity
  remote: RepoRemoteInfo
  currentBranch: string
}

export const DashboardHeader = defineComponent<DashboardHeaderProps>({
  name: 'DashboardHeader',
  props: ['workspace', 'remote', 'currentBranch'],
  setup(props) {
    const t = useT()
    return () => {
      const remoteState = dashboardRemoteState(props.remote)
      const displayLocation = formatWorkspaceDisplayLocation(
        props.workspace.id,
        remoteWorkspaceTarget(
          props.workspace.id,
          props.workspace.admission.kind === 'remote' ? props.workspace.admission.lifecycle : null,
        ),
      )
      const remoteLabelKey = remoteState.labelKey
      return (
        <div
          class={cn(
            DASHBOARD_CARD_CLASS,
            'flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between',
          )}
        >
          <div class="min-w-0">
            <div class="flex min-w-0 items-center gap-2">
              <h1 class="min-w-0 truncate text-base font-semibold text-foreground">
                {workspaceNameFromLocator(props.workspace.id)}
              </h1>
              <Badge variant="outline" class="text-muted-foreground">
                {props.currentBranch || t('dashboard.no-current-branch')}
              </Badge>
            </div>
            <div class="mt-1 truncate text-xs text-muted-foreground" title={displayLocation}>
              {displayLocation}
            </div>
          </div>
          <div class="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={remoteState.variant}>{t(remoteLabelKey)}</Badge>
          </div>
        </div>
      )
    }
  },
})

function dashboardRemoteState(remote: RepoRemoteInfo): {
  labelKey: 'dashboard.remote.connected' | 'dashboard.remote.local-only'
  variant: 'outline' | 'success'
} {
  return remote.hasRemotes
    ? { labelKey: 'dashboard.remote.connected', variant: 'success' }
    : { labelKey: 'dashboard.remote.local-only', variant: 'outline' }
}

interface DashboardStatsProps {
  compact: boolean
  summary: DashboardSummary
  pullRequestState: DashboardPullRequestState
}

export const DashboardStats = defineComponent<DashboardStatsProps>({
  name: 'DashboardStats',
  props: ['compact', 'summary', 'pullRequestState'],
  setup(props) {
    const t = useT()
    return () => (
      <div
        class={cn(
          'grid gap-2',
          props.compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
        )}
      >
        <DashboardMetricCard
          icon={GitBranch}
          label={t('dashboard.metric.branches')}
          value={props.summary.branchCount}
          detail={t('dashboard.metric.branches-detail', { count: props.summary.worktreeCount })}
        />
        <DashboardMetricCard
          icon={Workflow}
          label={t('dashboard.metric.worktrees')}
          value={props.summary.worktreeCount}
          detail={
            props.summary.dirtyWorktreeCount === undefined
              ? '—'
              : t('dashboard.metric.worktrees-detail', { count: props.summary.dirtyWorktreeCount })
          }
          tone={(props.summary.dirtyWorktreeCount ?? 0) > 0 ? 'attention' : 'default'}
        />
        <DashboardMetricCard
          icon={GitCompareArrows}
          label={t('dashboard.metric.sync')}
          value={`${props.summary.aheadCount}/${props.summary.behindCount}`}
          detail={t('dashboard.metric.sync-detail')}
          tone={props.summary.behindCount > 0 ? 'attention' : 'success'}
        />
        <DashboardMetricCard
          icon={GitPullRequest}
          label={t('dashboard.metric.prs')}
          value={pullRequestMetricValue(props.pullRequestState, props.summary.openPullRequestCount, t)}
          detail={t('dashboard.metric.prs-detail')}
        />
      </div>
    )
  },
})

function pullRequestMetricValue(
  state: DashboardPullRequestState,
  openCount: number | null | undefined,
  t: (key: string) => string,
): string | number {
  if (state === 'pending') return t('branch-status.pr.pending')
  if (state === 'unavailable') return t('branch-status.pr.unavailable')
  if (state === 'error') return t('branch-status.pr.failed')
  return openCount ?? '—'
}

interface DashboardAttentionProps {
  branchModel: DashboardRepositoryFacts
  summary: DashboardSummary
  onSelectBranch?: (branchName: string) => void
}

export const DashboardAttention = defineComponent<DashboardAttentionProps>({
  name: 'DashboardAttention',
  props: ['branchModel', 'summary', 'onSelectBranch'],
  setup(props) {
    const t = useT()
    return () => {
      if (props.summary.attentionBranches.length === 0) return null
      return (
        <DashboardSection title={t('dashboard.attention.title')} description={t('dashboard.attention.description')}>
          <div class="divide-y divide-separator">
            {props.summary.attentionBranches.map((item) => (
              <BranchAttentionRow
                key={item.branch.name}
                branchModel={props.branchModel}
                item={item}
                onSelectBranch={props.onSelectBranch}
              />
            ))}
          </div>
        </DashboardSection>
      )
    }
  },
})

interface BranchAttentionRowProps {
  branchModel: DashboardRepositoryFacts
  item: DashboardBranchItem
  onSelectBranch?: (branchName: string) => void
}

const BranchAttentionRow: FunctionalComponent<BranchAttentionRowProps> = (props) => (
  <button
    type="button"
    data-testid="dashboard-branch-link"
    class={cn(
      DASHBOARD_BRANCH_ROW_CLASS,
      'flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between',
      props.onSelectBranch && 'hover:bg-accent/45',
      !props.onSelectBranch && 'cursor-default',
    )}
    disabled={!props.onSelectBranch}
    onClick={() => props.onSelectBranch?.(props.item.branch.name)}
  >
    <BranchSummaryInline repo={{ status: props.branchModel.status }} branch={props.item.branch} />
    <BranchSignals item={props.item} />
  </button>
)

BranchAttentionRow.props = ['branchModel', 'item', 'onSelectBranch']

const BranchSignals = defineComponent<{ item: DashboardBranchItem }>({
  name: 'BranchSignals',
  props: ['item'],
  setup(props) {
    const t = useT()
    return () => {
      const { branch, dirty, pullRequest } = props.item
      return (
        <div class="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
          {dirty ? <Badge variant="attention">{t('branches.dirty')}</Badge> : null}
          {branch.trackingGone ? <Badge variant="attention">{t('branches.gone')}</Badge> : null}
          {branch.ahead > 0 ? <SignalDelta direction="ahead" count={branch.ahead} /> : null}
          {branch.behind > 0 ? <SignalDelta direction="behind" count={branch.behind} /> : null}
          {pullRequest?.checks?.failing ? (
            <Badge variant="danger">{t('dashboard.checks-failing', { count: pullRequest.checks.failing })}</Badge>
          ) : null}
        </div>
      )
    }
  },
})

const SignalDelta = defineComponent<{ direction: 'ahead' | 'behind'; count: number }>({
  name: 'SignalDelta',
  props: ['direction', 'count'],
  setup(props) {
    const t = useT()
    return () => {
      const Icon = props.direction === 'ahead' ? ArrowUp : ArrowDown
      const labelKey = props.direction === 'ahead' ? 'branch-status.sync.ahead' : 'branch-status.sync.behind'
      return (
        <span
          class={cn(
            'inline-flex items-center gap-0.5 font-mono text-xs',
            props.direction === 'ahead' ? 'text-success' : 'text-attention',
          )}
          title={t(labelKey, { n: props.count })}
        >
          <Icon size={11} />
          {props.count}
        </span>
      )
    }
  },
})

interface DashboardRecentBranchesProps {
  branchModel: DashboardRepositoryFacts
  branches: DashboardBranchItem[]
  onSelectBranch?: (branchName: string) => void
}

export const DashboardRecentBranches = defineComponent<DashboardRecentBranchesProps>({
  name: 'DashboardRecentBranches',
  props: ['branchModel', 'branches', 'onSelectBranch'],
  setup(props) {
    const t = useT()
    return () => (
      <DashboardSection title={t('dashboard.recent.title')} description={t('dashboard.recent.description')}>
        {props.branches.length > 0 ? (
          <div class="divide-y divide-separator">
            {props.branches.map((item) => (
              <button
                key={item.branch.name}
                type="button"
                data-testid="dashboard-branch-link"
                class={cn(
                  DASHBOARD_BRANCH_ROW_CLASS,
                  'block',
                  props.onSelectBranch && 'hover:bg-accent/45',
                  !props.onSelectBranch && 'cursor-default',
                )}
                disabled={!props.onSelectBranch}
                onClick={() => props.onSelectBranch?.(item.branch.name)}
              >
                <BranchSummaryInline repo={{ status: props.branchModel.status }} branch={item.branch} />
                <div
                  class="mt-0.5 truncate pl-5 text-[11px] text-muted-foreground"
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
  },
})
