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
): string {
  return [
    branch.name,
    branch.isDefault ? t('branches.default') : null,
    state.hasWorktree ? t(state.worktreeDirty ? 'branches.dirty' : 'branches.worktree') : null,
    branch.trackingGone ? t('branches.gone') : null,
    branch.ahead > 0 ? t('branch-status.sync.ahead', { n: branch.ahead }) : null,
    branch.behind > 0 ? t('branch-status.sync.behind', { n: branch.behind }) : null,
    state.commitMeta,
  ]
    .filter(Boolean)
    .join(', ')
}

// The status icon on the leading edge of a branch row. Worktree
// branches use a folder-tree glyph; regular local branches use the
// plain branch glyph.
// Kept as a 4-wide column so the name column has a stable left margin
// even when the icon kind changes.
export function BranchSummaryIcon({
  hasWorktree,
  worktreeDirty,
  selected,
}: {
  hasWorktree: boolean
  worktreeDirty: boolean
  selected: boolean
}) {
  return (
    <span className="flex w-4 shrink-0 items-center justify-center">
      {hasWorktree ? (
        <FolderTree size={14} className={worktreeDirty ? 'text-attention' : 'text-brand-text'} />
      ) : (
        <GitBranch size={14} className={selected ? 'text-selected-muted-foreground' : 'text-muted-foreground'} />
      )}
    </span>
  )
}

// The trailing metadata strip: optional badges (default / dirty /
// worktree / gone), ahead/behind deltas, and the last-commit author +
// relative time. Read-only by design — none of the inner spans are
// interactive. BranchRow renders it as part of BranchSummaryInline.
export function BranchSummaryMeta({
  repo,
  branch,
  selected = false,
}: Pick<BranchSummaryInlineProps, 'repo' | 'branch' | 'selected'>) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const { hasWorktree, worktreeDirty, commitMeta } = computeBranchSummaryState(branch, repo, lang)

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
      {hasWorktree && worktreeDirty ? (
        <Badge variant="attention" className="gap-1">
          <FolderTree size={10} />
          {t('branches.dirty')}
        </Badge>
      ) : hasWorktree ? (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <FolderTree size={10} />
          {t('branches.worktree')}
        </Badge>
      ) : null}
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

export function BranchSummaryInline({ repo, branch, selected = false, className }: BranchSummaryInlineProps) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const state = computeBranchSummaryState(branch, repo, lang)
  const { hasWorktree, worktreeDirty } = state
  const title = buildBranchSummaryTitle(state, branch, t)

  return (
    <div title={title} className={cn('flex min-w-0 items-center gap-2', className)}>
      <BranchSummaryIcon hasWorktree={hasWorktree} worktreeDirty={worktreeDirty} selected={selected} />
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
