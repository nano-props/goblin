import { ArrowDown, ArrowUp, Check, FolderTree, GitBranch } from 'lucide-react'
import { useI18nStore, useT } from '#/web/stores/i18n.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { Badge } from '#/web/components/ui/badge.tsx'
import { cn } from '#/web/lib/cn.ts'
import { formatRelativeTimeOrNull } from '#/web/lib/dates.ts'
import { getBranchWorktreeState, type BranchWorktreeRepo } from '#/web/stores/repos/worktree-state.ts'

export type BranchSummaryInlineRepo = BranchWorktreeRepo & {
  data: BranchWorktreeRepo['data'] & { currentBranch: string }
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

export function BranchSummaryInline({ repo, branch, selected = false, className }: BranchSummaryInlineProps) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const isCurrent = branch.name === repo.data.currentBranch
  const hasWorktree = !!branch.worktree?.path
  const isWorktree = hasWorktree && !isCurrent
  const worktreeState = getBranchWorktreeState(repo, branch)
  const worktreeDirty = worktreeState?.dirty ?? false
  const commitTime = formatRelativeTimeOrNull(branch.lastCommitDate, lang)
  const commitMeta = commitTime
    ? branch.lastCommitAuthor
      ? `${branch.lastCommitAuthor} · ${commitTime}`
      : commitTime
    : null
  const title = [
    branch.name,
    isCurrent ? t('branch-status.current') : null,
    branch.isDefault ? t('branches.default') : null,
    hasWorktree ? t(worktreeDirty ? 'branches.dirty' : 'branches.worktree') : null,
    branch.trackingGone ? t('branches.gone') : null,
    branch.ahead > 0 ? t('branch-status.sync.ahead', { n: branch.ahead }) : null,
    branch.behind > 0 ? t('branch-status.sync.behind', { n: branch.behind }) : null,
    commitMeta,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div title={title} className={cn('flex min-w-0 items-center gap-2', className)}>
      <span className="flex w-4 shrink-0 items-center justify-center">
        {isCurrent ? (
          <Check size={14} className="text-success" />
        ) : isWorktree ? (
          <FolderTree size={14} className={worktreeDirty ? 'text-attention' : 'text-brand-text'} />
        ) : (
          <GitBranch size={14} className={selected ? 'text-selected-muted-foreground' : 'text-muted-foreground'} />
        )}
      </span>
      <span className="flex min-w-0 items-center gap-2 overflow-hidden">
        <span
          className={cn(
            'shrink-0 truncate text-sm font-medium',
            selected ? 'text-selected-foreground' : 'text-foreground',
          )}
        >
          {branch.name}
        </span>
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
          ) : isWorktree ? (
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
            <Delta
              direction="behind"
              count={branch.behind}
              label={t('branch-status.sync.behind', { n: branch.behind })}
            />
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
      </span>
    </div>
  )
}
