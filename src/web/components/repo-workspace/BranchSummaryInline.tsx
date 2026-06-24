// Read-only branch "status strip" used in two places: the branch navigator
// rows (BranchRow). It is
// intentionally non-interactive; clicking the row selects the branch in
// the list.
//
// Layout (left to right):
//   [icon]  [name]  [meta…]  <badges · deltas · last-commit author/time>
//
// The icon and meta are exported as standalone subcomponents so callers
// that need a different name trigger
// can reuse the visual primitives without re-deriving the branch-state
// predicates.

import { ArrowDown, ArrowUp, FolderTree, GitBranch } from 'lucide-react'
import { useI18nStore, useT, type Lang } from '#/web/stores/i18n.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { Badge } from '#/web/components/ui/badge.tsx'
import { cn } from '#/web/lib/cn.ts'
import { formatRelativeTimeOrNull } from '#/web/lib/dates.ts'
import { getBranchWorktreeState, type BranchWorktreeRepo } from '#/web/stores/repos/worktree-state.ts'

export type BranchSummaryInlineRepo = BranchWorktreeRepo & {
  data: BranchWorktreeRepo['data']
}

interface BranchSummaryInlineProps {
  repo: BranchSummaryInlineRepo
  branch: RepoBranchState
  selected?: boolean
  terminalBellCount?: number
  className?: string
}

function Delta({ direction, count, label }: { direction: 'ahead' | 'behind'; count: number; label: string }) {
  const Icon = direction === 'ahead' ? ArrowUp : ArrowDown
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center gap-0.5 font-mono text-xs',
        direction === 'ahead' ? 'text-success' : 'text-attention',
      )}
    >
      <Icon size={11} />
      {count}
    </span>
  )
}

// Derives the visual-state predicates and last-commit meta for a
// (branch, repo) pair. Single source of truth shared by the icon, the
// meta strip, and the outer title — recomputing these in three places
// is what originally kept this file sprawling.
export function computeBranchSummaryState(branch: RepoBranchState, repo: BranchSummaryInlineRepo, lang: Lang) {
  const hasWorktree = !!branch.worktree?.path
  const worktreeState = getBranchWorktreeState(repo, branch)
  const worktreeDirty = worktreeState?.dirty ?? false
  const commitTime = formatRelativeTimeOrNull(branch.lastCommitDate, lang)
  const commitMeta = commitTime
    ? branch.lastCommitAuthor
      ? `${branch.lastCommitAuthor} · ${commitTime}`
      : commitTime
    : null
  return { hasWorktree, worktreeDirty, commitMeta }
}

type BranchSummaryState = ReturnType<typeof computeBranchSummaryState>

// Comma-joined `title` attribute. Mirrors the visible body so the hover
// tooltip stays consistent across the branch navigator.
export function buildBranchSummaryTitle(
  state: BranchSummaryState,
  branch: RepoBranchState,
  t: (key: string, params?: Record<string, string | number>) => string,
  terminalBellCount = 0,
): string {
  const worktreeStateLabelKey = state.worktreeDirty ? 'branches.dirty' : 'branches.worktree'
  return [
    branch.name,
    branch.isDefault ? t('branches.default') : null,
    state.hasWorktree ? t(worktreeStateLabelKey) : null,
    terminalBellCount > 0 ? t('terminal.bell-unread-count', { count: terminalBellCount }) : null,
    branch.trackingGone ? t('branches.gone') : null,
    branch.ahead > 0 ? t('branch-status.sync.ahead', { n: branch.ahead }) : null,
    branch.behind > 0 ? t('branch-status.sync.behind', { n: branch.behind }) : null,
    state.commitMeta,
  ]
    .filter(Boolean)
    .join(', ')
}

// The status icon on the leading edge of a branch row. Carries the
// worktree-vs-branch distinction (FolderTree vs GitBranch) plus the
// dirty state (icon color + aria-label). The trailing meta strip no
// longer renders worktree / dirty badges — this icon is the single
// visual + accessible signal for both.
// Kept as a 4-wide column so the name column has a stable left margin
// even when the icon kind changes.
export function BranchSummaryIcon({
  hasWorktree,
  worktreeDirty,
  selected,
  ariaLabel,
}: {
  hasWorktree: boolean
  worktreeDirty: boolean
  selected: boolean
  // Screen-reader text for the glyph. The icon is otherwise decorative —
  // passing a label keeps the worktree / dirty state announced when the
  // corresponding badge is hidden (see BranchSummaryMeta).
  ariaLabel?: string
}) {
  return (
    <span
      data-testid="branch-summary-icon"
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
      className="flex w-4 shrink-0 items-center justify-center"
    >
      {hasWorktree ? (
        <FolderTree size={14} className={worktreeDirty ? 'text-attention' : 'text-brand-text'} aria-hidden="true" />
      ) : (
        <GitBranch size={14} className={selected ? 'text-selected-muted-foreground' : 'text-muted-foreground'} aria-hidden="true" />
      )}
    </span>
  )
}

// The trailing metadata strip: optional badges (default / gone),
// ahead/behind deltas, and the last-commit author + relative time.
// Worktree-vs-branch and dirty-vs-clean are both carried by the
// leading BranchSummaryIcon glyph — no worktree / dirty badges here.
// Read-only by design — none of the inner spans are interactive.
// BranchRow renders it as part of BranchSummaryInline.
export function BranchSummaryMeta({
  repo,
  branch,
  selected = false,
}: Pick<BranchSummaryInlineProps, 'repo' | 'branch' | 'selected'>) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const { commitMeta } = computeBranchSummaryState(branch, repo, lang)

  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-1.5 overflow-hidden text-xs',
        selected ? 'text-selected-muted-foreground' : 'text-muted-foreground',
      )}
    >
      {branch.isDefault && (
        <Badge variant="outline" className="text-muted-foreground">
          {t('branches.default')}
        </Badge>
      )}
      {branch.trackingGone && <Badge variant="attention">{t('branches.gone')}</Badge>}
      {branch.ahead > 0 && (
        <Delta direction="ahead" count={branch.ahead} label={t('branch-status.sync.ahead', { n: branch.ahead })} />
      )}
      {branch.behind > 0 && (
        <Delta direction="behind" count={branch.behind} label={t('branch-status.sync.behind', { n: branch.behind })} />
      )}
      {commitMeta && (
        <span
          className={cn(
            'min-w-0 truncate whitespace-nowrap text-[11px] leading-none',
            selected ? 'text-selected-muted-foreground/90' : 'text-muted-foreground/85',
          )}
          title={commitMeta}
        >
          {commitMeta}
        </span>
      )}
    </span>
  )
}

function BranchTerminalBellBadge({ count }: { count: number }) {
  const t = useT()
  if (count <= 0) return null
  const label = t('terminal.bell-unread-count', { count })
  const displayCount = count > 99 ? '99+' : String(count)
  return (
    <span
      aria-label={label}
      title={label}
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-notification px-1 font-mono text-[10px] font-semibold leading-none text-notification-foreground tabular-nums"
    >
      {displayCount}
    </span>
  )
}

export function BranchSummaryInline({
  repo,
  branch,
  selected = false,
  terminalBellCount = 0,
  className,
}: BranchSummaryInlineProps) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const state = computeBranchSummaryState(branch, repo, lang)
  const { hasWorktree, worktreeDirty } = state
  const title = buildBranchSummaryTitle(state, branch, t, terminalBellCount)
  // Surface the worktree state to screen readers via the icon's
  // aria-label — the meta strip no longer renders worktree / dirty
  // badges, so this is the only textual cue left.
  const iconAriaLabel = hasWorktree ? (worktreeDirty ? t('branches.dirty') : t('branches.worktree')) : undefined

  return (
    <div title={title} className={cn('flex min-w-0 items-center gap-2', className)}>
      {terminalBellCount > 0 ? (
        <span className="flex w-4 shrink-0 items-center justify-center">
          <BranchTerminalBellBadge count={terminalBellCount} />
        </span>
      ) : (
        <BranchSummaryIcon
          hasWorktree={hasWorktree}
          worktreeDirty={worktreeDirty}
          selected={selected}
          ariaLabel={iconAriaLabel}
        />
      )}
      <span className="flex min-w-0 items-center gap-2 overflow-hidden">
        <span
          className={cn(
            'shrink-0 truncate text-sm font-medium',
            selected ? 'text-selected-foreground' : 'text-foreground',
          )}
        >
          {branch.name}
        </span>
        <BranchSummaryMeta repo={repo} branch={branch} selected={selected} />
      </span>
    </div>
  )
}
