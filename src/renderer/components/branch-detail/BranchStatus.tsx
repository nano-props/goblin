import { ArrowDown, ArrowUp, Check, FolderTree, GitBranch, GitMerge, RadioTower, RefreshCw } from 'lucide-react'
import { useT } from '#/renderer/stores/i18n.ts'
import { EmptyState, ScrollPane } from '#/renderer/components/Layout.tsx'
import { PullRequestStatusRow } from '#/renderer/components/branch-detail/PullRequestStatusRow.tsx'
import {
  CopyableValue,
  MonoValue,
  StatusChip,
  StatusRow,
  StatusRows,
  type Tone,
} from '#/renderer/components/branch-detail/status-ui.tsx'
import { tildify } from '#/renderer/lib/paths.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import type { SelectedBranchDetail } from '#/renderer/components/branch-detail/model.ts'

interface Props {
  detail: SelectedBranchDetail
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
  if (noUpstream) return <StatusChip tone="warning">{upToDateLabel}</StatusChip>
  if (ahead === 0 && behind === 0) {
    return (
      <StatusChip tone="success">
        <Check size={11} />
        {upToDateLabel}
      </StatusChip>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {ahead > 0 && (
        <StatusChip tone="success">
          <ArrowUp size={12} />
          {aheadLabel}
        </StatusChip>
      )}
      {behind > 0 && (
        <StatusChip tone="warning">
          <ArrowDown size={12} />
          {behindLabel}
        </StatusChip>
      )}
    </span>
  )
}

export function BranchStatus({ detail }: Props) {
  const t = useT()
  const { branch, statusCount } = detail
  if (!branch) return <EmptyState title={t('branches.empty')} />

  const protectedBranch = PROTECTED_BRANCHES.has(branch.name)
  const worktreePath = branch.worktreePath ? tildify(branch.worktreePath) : ''
  const worktreeChangeCount = statusCount > 0 ? statusCount : (branch.worktreeChangeCount ?? 0)
  const hasRole = branch.isCurrent || branch.isDefault || protectedBranch
  const hasWorktreeChanges = !!branch.worktreePath && (branch.worktreeDirty || worktreeChangeCount > 0)
  const mergeKnown = branch.isDefault || branch.mergedToDefault !== undefined
  const showMerged = !branch.isDefault
  const mergeLabel = !mergeKnown
    ? t('branch-status.merge-unknown')
    : branch.mergedToDefault || branch.isDefault
      ? t('branch-status.merged')
      : t('branch-status.not-merged')
  const mergeTone: Tone = !mergeKnown ? 'neutral' : branch.mergedToDefault ? 'success' : 'warning'
  const remoteTone: Tone = branch.trackingGone || !branch.tracking ? 'warning' : 'brand'
  const syncTone: Tone = !branch.tracking ? 'warning' : branch.behind > 0 ? 'warning' : 'success'
  const worktreeTone: Tone =
    branch.worktreeLocked || hasWorktreeChanges ? 'warning' : branch.worktreePath ? 'brand' : 'neutral'
  const worktreeValue = branch.worktreePath ? (
    <CopyableValue
      value={worktreePath}
      copyValue={branch.worktreePath}
      copyLabel={t('branch-status.copy-worktree-path')}
      copiedLabel={t('branch-status.copied')}
    />
  ) : (
    <StatusChip>{t('branch-status.worktree.none')}</StatusChip>
  )
  const worktreeAfter =
    branch.worktreeLocked || hasWorktreeChanges ? (
      <>
        {branch.worktreeLocked && <StatusChip tone="warning">{t('branch-status.worktree.locked')}</StatusChip>}
        {hasWorktreeChanges && (
          <StatusChip tone="warning">{t('branch-status.worktree-dirty', { n: worktreeChangeCount })}</StatusChip>
        )}
      </>
    ) : undefined
  const remoteValue = branch.tracking ? (
    <MonoValue tone={branch.trackingGone ? 'warning' : undefined}>{branch.tracking}</MonoValue>
  ) : (
    <StatusChip tone="warning">{t('branches.no-upstream')}</StatusChip>
  )
  const remoteAfter = branch.trackingGone ? <StatusChip tone="warning">{t('branches.gone')}</StatusChip> : undefined

  const roleChips = hasRole ? (
    <>
      {branch.isCurrent && <StatusChip tone="success">{t('branch-status.current')}</StatusChip>}
      {branch.isDefault && <StatusChip>{t('branches.default')}</StatusChip>}
      {protectedBranch && <StatusChip>{t('branch-status.protected')}</StatusChip>}
    </>
  ) : undefined
  return (
    <ScrollPane>
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
          tone={branch.isCurrent ? 'success' : branch.isDefault ? 'brand' : 'neutral'}
        />
        <StatusRow
          icon={<FolderTree size={14} />}
          label={t('branch-status.signal.worktree')}
          value={worktreeValue}
          after={worktreeAfter}
          tone={worktreeTone}
        />
        <StatusRow
          icon={<RadioTower size={14} />}
          label={t('branch-status.signal.remote')}
          value={remoteValue}
          after={remoteAfter}
          tone={remoteTone}
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
            tone={mergeTone}
          />
        )}
        <PullRequestStatusRow pullRequest={branch.pullRequest} />
      </StatusRows>
    </ScrollPane>
  )
}
