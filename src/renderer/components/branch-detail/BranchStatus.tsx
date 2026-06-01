import { ArrowDown, ArrowUp, Check, FolderTree, GitBranch, GitMerge, RadioTower, RefreshCw } from 'lucide-react'
import { useT } from '#/renderer/stores/i18n.ts'
import { EmptyState } from '#/renderer/components/Layout.tsx'
import { PullRequestStatusRow } from '#/renderer/components/branch-detail/PullRequestStatusRow.tsx'
import {
  CopyableValue,
  MonoValue,
  StatusChip,
  StatusRow,
  StatusRows,
  type Tone,
} from '#/renderer/components/branch-detail/status-ui.tsx'
import { formatWorktreePath } from '#/renderer/lib/paths.ts'
import { PROTECTED_BRANCHES, branchPullRequestBelongsToBranch } from '#/shared/git-types.ts'
import type { SelectedBranchDetail } from '#/renderer/components/branch-detail/model.ts'
import type { RepoWorkspaceLayout } from '#/renderer/stores/repos/types.ts'
import { repoWorkspaceBehavior } from '#/renderer/lib/workspace-layout.ts'

interface Props {
  detail: SelectedBranchDetail
  layout: RepoWorkspaceLayout
}

function SyncValue({
  ahead,
  behind,
  noUpstream,
  upToDateLabel,
  aheadLabel,
  behindLabel,
}: {
  ahead: number
  behind: number
  noUpstream: boolean
  upToDateLabel: string
  aheadLabel: string
  behindLabel: string
}) {
  if (noUpstream) return <StatusChip tone="attention">{upToDateLabel}</StatusChip>
  if (ahead === 0 && behind === 0) {
    return (
      <StatusChip tone="success">
        <Check size={11} />
        {upToDateLabel}
      </StatusChip>
    )
  }

  return (
    <>
      {ahead > 0 && (
        <StatusChip tone="success">
          <ArrowUp size={12} />
          {aheadLabel}
        </StatusChip>
      )}
      {behind > 0 && (
        <StatusChip tone="attention">
          <ArrowDown size={12} />
          {behindLabel}
        </StatusChip>
      )}
    </>
  )
}

export function BranchStatus({ detail, layout }: Props) {
  const t = useT()
  const { branch, statusCount } = detail
  const behavior = repoWorkspaceBehavior(layout, false)
  if (!branch) return <EmptyState title={t('branches.empty')} />

  const protectedBranch = PROTECTED_BRANCHES.has(branch.name)
  const worktreePath = branch.worktree?.path ? formatWorktreePath(branch.worktree?.path, detail.remoteTarget) : ''
  const worktreeChangeCount = detail.worktreeState?.changeCount ?? statusCount
  const pullRequest =
    branch.pullRequest && branchPullRequestBelongsToBranch(branch, branch.pullRequest) ? branch.pullRequest : undefined
  const hasRole = branch.isCurrent || branch.isDefault || protectedBranch
  const hasWorktreeChanges = !!branch.worktree?.path && (detail.worktreeState?.dirty || worktreeChangeCount > 0)
  const mergeKnown = branch.isDefault || branch.mergedToDefault !== undefined
  const showMerged = !branch.isDefault
  const mergeLabel = !mergeKnown
    ? t('branch-status.merge-unknown')
    : branch.mergedToDefault || branch.isDefault
      ? t('branch-status.merged')
      : t('branch-status.not-merged')
  const mergeTone: Tone = !mergeKnown ? 'neutral' : branch.mergedToDefault ? 'success' : 'attention'
  const upstreamTone: Tone = branch.trackingGone || !branch.tracking ? 'attention' : 'brand'
  const syncTone: Tone = !branch.tracking ? 'attention' : branch.behind > 0 ? 'attention' : 'success'
  const worktreeLocked = detail.worktreeState?.isLocked ?? false
  const worktreeTone: Tone =
    worktreeLocked || hasWorktreeChanges ? 'attention' : branch.worktree?.path ? 'brand' : 'neutral'
  const worktreeValue = branch.worktree?.path ? (
    <CopyableValue
      value={worktreePath}
      copyValue={branch.worktree?.path}
      copyLabel={t('branch-status.copy-worktree-path')}
      copiedLabel={t('branch-status.copied')}
    />
  ) : (
    <StatusChip>{t('branch-status.worktree.none')}</StatusChip>
  )
  const worktreeAfter =
    worktreeLocked || hasWorktreeChanges ? (
      <>
        {worktreeLocked && <StatusChip tone="attention">{t('branch-status.worktree.locked')}</StatusChip>}
        {hasWorktreeChanges && (
          <StatusChip tone="attention">{t('branch-status.worktree-dirty', { n: worktreeChangeCount })}</StatusChip>
        )}
      </>
    ) : undefined
  const upstreamValue = branch.tracking ? (
    <MonoValue title={branch.tracking} tone={branch.trackingGone ? 'attention' : undefined} truncate>
      {branch.tracking}
    </MonoValue>
  ) : (
    <StatusChip tone="attention">{t('branches.no-upstream')}</StatusChip>
  )
  const upstreamAfter = branch.trackingGone ? (
    <StatusChip tone="attention">{t('branches.gone')}</StatusChip>
  ) : !branch.tracking && pullRequest ? (
    <StatusChip>{t('branch-status.upstream.pr-only')}</StatusChip>
  ) : undefined

  const roleChips = hasRole ? (
    <>
      {branch.isCurrent && <StatusChip tone="success">{t('branch-status.current')}</StatusChip>}
      {branch.isDefault && <StatusChip>{t('branches.default')}</StatusChip>}
      {protectedBranch && <StatusChip>{t('branch-status.protected')}</StatusChip>}
    </>
  ) : undefined
  return (
    <StatusRows>
      <StatusRow
        icon={<GitBranch size={15} />}
        label={t('branch-status.signal.branch')}
        value={
          <CopyableValue
            value={branch.name}
            copyLabel={t('branch-status.copy-branch-name')}
            copiedLabel={t('branch-status.copied')}
          />
        }
        after={roleChips}
        valueLayout="inline"
        tone={branch.isCurrent ? 'success' : branch.isDefault ? 'brand' : 'neutral'}
      />
      <StatusRow
        icon={<FolderTree size={14} />}
        label={t('branch-status.signal.worktree')}
        value={worktreeValue}
        after={worktreeAfter}
        valueLayout="inline"
        tone={worktreeTone}
      />
      <StatusRow
        icon={<RadioTower size={14} />}
        label={t('branch-status.signal.upstream')}
        value={upstreamValue}
        after={upstreamAfter}
        valueLayout="inline"
        tone={upstreamTone}
      />
      <StatusRow
        icon={<RefreshCw size={14} />}
        label={t('branch-status.signal.sync')}
        value={
          <SyncValue
            ahead={branch.ahead}
            behind={branch.behind}
            noUpstream={!branch.tracking}
            upToDateLabel={!branch.tracking ? t('branches.no-upstream') : t('branch-status.sync.up-to-date')}
            aheadLabel={t('branch-status.sync.ahead', { n: branch.ahead })}
            behindLabel={t('branch-status.sync.behind', { n: branch.behind })}
          />
        }
        valueLayout="chips"
        tone={syncTone}
      />
      {showMerged && (
        <StatusRow
          icon={<GitMerge size={14} />}
          label={t('branch-status.signal.merge')}
          value={
            <StatusChip tone={mergeTone}>
              {mergeKnown && branch.mergedToDefault && <Check size={11} />}
              {mergeLabel}
            </StatusChip>
          }
          valueLayout="chips"
          tone={mergeTone}
        />
      )}
      <PullRequestStatusRow pullRequest={pullRequest} tooltipSide={behavior.prTooltipSide} />
    </StatusRows>
  )
}
