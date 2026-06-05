import { type RefObject } from 'react'
import { ArrowDown, ArrowUp, Check, FolderTree, GitBranch } from 'lucide-react'
import { useI18nStore, useT } from '#/web/stores/i18n.ts'
import type { RepoBranchState, RepoState } from '#/web/stores/repos/types.ts'
import { Badge } from '#/web/components/ui/badge.tsx'
import { BranchActionsMenu } from '#/web/components/BranchActionsMenu.tsx'
import { cn } from '#/web/lib/cn.ts'
import { formatRelativeTimeOrNull } from '#/web/lib/dates.ts'
import { getBranchWorktreeState } from '#/web/stores/repos/worktree-state.ts'
interface BranchRowProps {
  repo: RepoState
  branch: RepoBranchState
  selected: string | null
  current: string
  onSelectBranch: (branch: string) => void
  onOpenBranchStatus: (branch: string) => void
  selectedRef: RefObject<HTMLLIElement | null>
  showActions?: boolean
  actionMenuOpen?: boolean
  onActionMenuOpenChange?: (open: boolean) => void
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

export function BranchRow({
  repo,
  branch,
  selected,
  current,
  onSelectBranch,
  onOpenBranchStatus,
  selectedRef,
  showActions = true,
  actionMenuOpen,
  onActionMenuOpenChange,
}: BranchRowProps) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const isSelected = branch.name === selected
  const isCurrent = branch.name === current
  const hasWorktree = !!branch.worktree?.path
  const isWorktree = hasWorktree && !isCurrent
  const worktreeState = getBranchWorktreeState(repo, branch)
  const worktreeDirty = worktreeState?.dirty ?? false
  const commitTime = formatRelativeTimeOrNull(branch.lastCommitDate, lang)
  const commitMeta = commitTime ? (branch.lastCommitAuthor ? `${branch.lastCommitAuthor} · ${commitTime}` : commitTime) : null
  const ariaParts = [
    branch.name,
    isCurrent ? t('branch-status.current') : null,
    branch.isDefault ? t('branches.default') : null,
    hasWorktree ? t(worktreeDirty ? 'branches.dirty' : 'branches.worktree') : null,
    branch.trackingGone ? t('branches.gone') : null,
    branch.ahead > 0 ? t('branch-status.sync.ahead', { n: branch.ahead }) : null,
    branch.behind > 0 ? t('branch-status.sync.behind', { n: branch.behind }) : null,
    commitMeta,
  ].filter(Boolean)

  return (
    <li
      ref={isSelected ? selectedRef : undefined}
      title={ariaParts.join(', ')}
      onClick={() => onSelectBranch(branch.name)}
      onDoubleClick={() => onOpenBranchStatus(branch.name)}
      className={cn(
        'relative grid min-h-9 items-stretch cursor-pointer',
        showActions ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1',
        'transition-colors duration-100',
        isSelected ? 'bg-selected text-selected-foreground hover:bg-selected' : 'hover:bg-muted',
      )}
    >
      <div className="pointer-events-none relative z-10 grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-x-2 px-4 py-1.5">
        <span className="flex w-4 shrink-0 items-center justify-center">
          {isCurrent ? (
            <Check size={14} className="text-success" />
          ) : isWorktree ? (
            <FolderTree size={14} className={worktreeDirty ? 'text-attention' : 'text-brand-text'} />
          ) : (
            <GitBranch size={14} className={isSelected ? 'text-selected-muted-foreground' : 'text-muted-foreground'} />
          )}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'shrink-0 truncate text-sm font-medium',
              isSelected ? 'text-selected-foreground' : 'text-foreground',
            )}
          >
            {branch.name}
          </span>
          <span
            className={cn(
              'flex min-w-0 items-center gap-1.5 overflow-hidden text-xs',
              isSelected ? 'text-selected-muted-foreground' : 'text-muted-foreground',
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
              <Delta
                direction="ahead"
                count={branch.ahead}
                label={t('branch-status.sync.ahead', { n: branch.ahead })}
              />
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
                  isSelected ? 'text-selected-muted-foreground/90' : 'text-muted-foreground/85',
                )}
                title={commitMeta}
              >
                {commitMeta}
              </span>
            )}
          </span>
        </span>
      </div>
      {showActions && (
        <div className="pointer-events-none relative z-20 flex shrink-0 items-center py-1.5 pr-4">
          <div className="pointer-events-auto">
            <BranchActionsMenu
              repo={repo}
              branch={branch}
              open={actionMenuOpen}
              onOpenChange={onActionMenuOpenChange}
            />
          </div>
        </div>
      )}
    </li>
  )
}
