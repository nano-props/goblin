import { useMemo } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Diff,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  RadioTower,
  RefreshCw,
} from 'lucide-react'
import { throttle } from 'es-toolkit'
import { useI18nStore, useT } from '#/web/stores/i18n.ts'
import { EmptyState } from '#/web/components/Layout.tsx'
import { PullRequestStatusRow } from '#/web/components/repo-workspace/PullRequestStatusRow.tsx'
import { IconCopyButton } from '#/web/components/IconCopyButton.tsx'
import type { BranchCopyPatchAction } from '#/web/hooks/branch-action-state.ts'
import { useActionFeedback } from '#/web/hooks/useActionFeedback.ts'
import { useBranchActionSurface } from '#/web/components/repo-workspace/branch-action-surface-context.ts'
import {
  CopyableValue,
  StatusChip,
  StatusLink,
  StatusRow,
  StatusRows,
  type Tone,
} from '#/web/components/repo-workspace/status-ui.tsx'
import { formatRelativeTimeOrNull } from '#/web/lib/dates.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { formatWorktreePath } from '#/web/lib/paths.ts'
import { remoteRepoTarget } from '#/web/stores/repos/repo-guards.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { PROTECTED_BRANCHES, branchPullRequestBelongsToBranch } from '#/shared/git-types.ts'
import { openUpstreamBranchExternalTarget } from '#/web/hooks/openBranchExternalTarget.ts'
import { openRepoUrl } from '#/web/repo-client.ts'
import type { SelectedRepoWorkspace } from '#/web/components/repo-workspace/model.ts'
interface Props {
  detail: SelectedRepoWorkspace
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

function StatusCopyPatchButton({ action }: { action: BranchCopyPatchAction }) {
  const t = useT()
  const { succeeded, trigger } = useActionFeedback()
  const busy = !!action.busy
  // Icon-only button — the label drives both the visible Tooltip and the
  // aria-label. Use the descriptive `action.title` (vs the short
  // `status.copy-patch-label`) so screen-reader users and sighted users
  // hovering the button learn it copies a git-apply patch specifically.
  const showCheck = succeeded && !busy
  const label = showCheck ? t('status.copy-patch-success') : (action.title ?? t('status.copy-patch-label'))

  const handleClick = () => {
    if (action.busy || action.disabled) return
    trigger(action.onSelect)
  }

  return (
    <IconCopyButton
      label={label}
      succeeded={showCheck}
      busy={busy}
      disabled={action.disabled || busy}
      onClick={handleClick}
    />
  )
}

// Clickable commit-hash link. The throttle mirrors the same anti-double-
// click treatment used by the upstream and PR badge handlers so a single
// user intent produces a single browser tab. Visual styling matches the
// pre-existing hash chip (mono, brand-tinted, non-shrinking).
function CommitHashLink({ repoId, hash, title }: { repoId: string; hash: string; title: string }) {
  const handleClick = useMemo(
    () =>
      throttle(
        () => {
          void openRepoUrl(repoId, { type: 'commit', hash }).catch(() => {})
        },
        500,
        { edges: ['leading'] },
      ),
    [repoId, hash],
  )
  return (
    <StatusLink
      mono
      tone="brand"
      title={title}
      data-commit-link=""
      onClick={handleClick}
      className="shrink-0 text-sm font-medium tabular-nums leading-none text-brand-text/85"
    >
      {hash}
    </StatusLink>
  )
}

// Clickable upstream ref (e.g. `origin/main`). Routes through
// `openUpstreamBranchExternalTarget` so the helper resolves the named
// remote instead of guessing from the local branch's tracking config.
function UpstreamLink({
  repoId,
  tracking,
  title,
  tone,
}: {
  repoId: string
  tracking: string
  title: string
  tone?: Tone
}) {
  const handleClick = useMemo(
    () =>
      throttle(
        () => {
          void openUpstreamBranchExternalTarget(repoId, tracking).catch(() => {})
        },
        500,
        { edges: ['leading'] },
      ),
    [repoId, tracking],
  )
  return (
    <StatusLink mono title={title} data-upstream-link="" tone={tone} truncate onClick={handleClick}>
      {tracking}
    </StatusLink>
  )
}

export function BranchStatus({ detail }: Props) {
  const { copyPatchAction } = useBranchActionSurface()
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const compact = useIsCompactUi()
  const { branch, statusCount } = detail
  // Phase 4: pull the target off the lifecycle union. The
  // selector is keyed on the lifecycle itself, so a re-probe
  // (e.g. network reconnect) re-renders this row.
  const worktreeTarget = useReposStore((s) => {
    const repo = s.repos[detail.repoId]
    return repo ? remoteRepoTarget(repo.id, repo.remote.lifecycle) : null
  })
  if (!branch) return <EmptyState title={t('branches.empty')} />
  const protectedBranch = PROTECTED_BRANCHES.has(branch.name)
  const worktreePath = branch.worktree?.path ? formatWorktreePath(branch.worktree?.path, worktreeTarget) : ''
  const worktreeChangeCount = detail.worktreeState?.changeCount ?? statusCount
  const pullRequest =
    branch.pullRequest && branchPullRequestBelongsToBranch(branch, branch.pullRequest) ? branch.pullRequest : undefined
  const hasRole = branch.isDefault || protectedBranch
  // Gate on the same value the chip displays. If `worktreeChangeCount` is 0,
  // the row shows "0 changes" and there's nothing to copy — keep the
  // button hidden so we don't surface an action next to a contradictory chip.
  const hasWorktreeChanges = !!branch.worktree?.path && worktreeChangeCount > 0
  const mergeKnown = branch.isDefault || branch.mergedToDefault !== undefined
  const showMerged = !branch.isDefault
  const commitTime = formatRelativeTimeOrNull(branch.lastCommitDate, lang)
  const commitMeta = commitTime
    ? branch.lastCommitAuthor
      ? `${branch.lastCommitAuthor} · ${commitTime}`
      : commitTime
    : null
  const mergeLabel = !mergeKnown
    ? t('branch-status.merge-unknown')
    : branch.mergedToDefault || branch.isDefault
      ? t('branch-status.merged')
      : t('branch-status.not-merged')
  const mergeTone: Tone = !mergeKnown ? 'neutral' : branch.mergedToDefault ? 'success' : 'attention'
  const upstreamTone: Tone = branch.trackingGone || !branch.tracking ? 'attention' : 'brand'
  const syncTone: Tone = !branch.tracking ? 'attention' : branch.behind > 0 ? 'attention' : 'success'
  const worktreeLocked = detail.worktreeState?.isLocked ?? false
  // The "dirty worktree" signal moved to its own row below; the worktree
  // row only needs to surface lock state on its own.
  const worktreeTone: Tone = worktreeLocked ? 'attention' : branch.worktree?.path ? 'brand' : 'neutral'
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
  const worktreeAfter = worktreeLocked ? (
    <StatusChip tone="attention">{t('branch-status.worktree.locked')}</StatusChip>
  ) : undefined
  const upstreamValue = branch.tracking ? (
    <UpstreamLink
      repoId={detail.repoId}
      tracking={branch.tracking}
      title={t('branch-status.upstream.open-externally')}
      tone={branch.trackingGone ? 'attention' : undefined}
    />
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
        tone={branch.isDefault ? 'brand' : 'neutral'}
      />
      <StatusRow
        icon={<FolderTree size={14} />}
        label={t('branch-status.signal.worktree')}
        value={worktreeValue}
        after={worktreeAfter}
        valueLayout="inline"
        tone={worktreeTone}
      />
      {hasWorktreeChanges && (
        <StatusRow
          icon={<Diff size={14} />}
          label={t('branch-status.signal.changes')}
          value={
            <StatusChip tone="attention">{t('branch-status.changes-count', { n: worktreeChangeCount })}</StatusChip>
          }
          after={copyPatchAction.visible ? <StatusCopyPatchButton action={copyPatchAction} /> : undefined}
          valueLayout="inline"
          tone="attention"
        />
      )}
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
      <StatusRow
        icon={<GitCommitHorizontal size={14} />}
        label={t('branch-status.signal.commit')}
        value={
          <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden text-sm text-foreground">
            {branch.lastCommitHash ? (
              <CommitHashLink
                repoId={detail.repoId}
                hash={branch.lastCommitHash}
                title={t('branch-status.commit.open-externally')}
              />
            ) : null}
            <span
              className="min-w-0 truncate leading-tight text-foreground/95"
              title={branch.lastCommitMessage || undefined}
            >
              {branch.lastCommitMessage || '—'}
            </span>
            {commitMeta && (
              <span
                className="shrink-0 whitespace-nowrap text-xs leading-tight text-muted-foreground/85"
                title={commitMeta}
              >
                {commitMeta}
              </span>
            )}
          </div>
        }
        valueLayout="fill"
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
      <PullRequestStatusRow
        repoId={detail.repoId}
        branchName={branch.name}
        pullRequest={pullRequest}
        tooltipSide={compact ? 'top' : 'bottom'}
      />
    </StatusRows>
  )
}
