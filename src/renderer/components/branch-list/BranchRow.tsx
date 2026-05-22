import { type RefObject } from 'react'
import { ArrowDown, ArrowUp, Check, FolderTree, GitBranch } from 'lucide-react'
import { useT, type Lang } from '#/renderer/stores/i18n.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { BranchActionsMenu } from '#/renderer/components/BranchActionsMenu.tsx'
import { cn } from '#/renderer/lib/cn.ts'
import { formatRelativeTime } from '#/renderer/lib/dates.ts'
import type { BranchInfo } from '#/renderer/types.ts'

interface BranchRowProps {
  repo: RepoState
  branch: BranchInfo
  selected: string | null
  current: string
  lang: Lang
  selectBranch: (id: string, branch: string) => void
  selectedRef: RefObject<HTMLLIElement | null>
  ghosttyInstalled: boolean
  vscodeInstalled: boolean
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
        direction === 'ahead' ? 'text-success' : 'text-warning',
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
  lang,
  selectBranch,
  selectedRef,
  ghosttyInstalled,
  vscodeInstalled,
}: BranchRowProps) {
  const t = useT()
  const isSelected = branch.name === selected
  const isCurrent = branch.name === current
  const hasWorktree = !!branch.worktreePath
  const isWorktree = hasWorktree && !isCurrent
  const commitTime = formatRelativeTime(branch.lastCommitDate, lang)
  const commitMeta = branch.lastCommitAuthor ? `${branch.lastCommitAuthor} · ${commitTime}` : commitTime

  return (
    <li
      ref={isSelected ? selectedRef : undefined}
      data-interactive
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-start',
        'transition-colors duration-100',
        isSelected ? 'bg-selected text-selected-foreground hover:bg-selected' : 'hover:bg-muted',
      )}
    >
      <button
        type="button"
        aria-current={isSelected ? 'true' : undefined}
        onClick={() => selectBranch(repo.id, branch.name)}
        className="grid min-w-0 cursor-pointer grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 px-4 py-2 text-left focus:outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex size-4 shrink-0 items-center justify-center pt-0.5">
          {isCurrent ? (
            <Check size={14} className="text-success" />
          ) : isWorktree ? (
            <FolderTree size={14} className={branch.worktreeDirty ? 'text-warning' : 'text-brand-text'} />
          ) : (
            <GitBranch size={14} className="text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">{branch.name}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              {branch.isDefault && (
                <Badge variant="outline" className="font-mono text-muted-foreground">
                  {t('branches.default')}
                </Badge>
              )}
              {hasWorktree && branch.worktreeDirty ? (
                <Badge variant="warning" className="gap-1 font-mono">
                  <FolderTree size={10} />
                  {t('branches.dirty')}
                </Badge>
              ) : isWorktree ? (
                <Badge variant="outline" className="gap-1 font-mono text-muted-foreground">
                  <FolderTree size={10} />
                  {t('branches.worktree')}
                </Badge>
              ) : null}
              {branch.trackingGone && (
                <Badge variant="warning" className="font-mono">
                  {t('branches.gone')}
                </Badge>
              )}
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
            </span>
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate" title={branch.lastCommitMessage || undefined}>
              {branch.lastCommitMessage || '—'}
            </span>
            <span className="max-w-44 shrink-0 truncate" title={commitMeta}>
              {commitMeta}
            </span>
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-start py-2 pr-4">
        <BranchActionsMenu
          repo={repo}
          branch={branch}
          ghosttyInstalled={ghosttyInstalled}
          vscodeInstalled={vscodeInstalled}
        />
      </div>
    </li>
  )
}
