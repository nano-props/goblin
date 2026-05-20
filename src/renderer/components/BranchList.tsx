// Persistent branch list. Each row shows branch name, lightweight
// scan signals, and the head commit subject + relative date. The
// selected row scrolls into view automatically when the user moves with
// j/k so a long branch list doesn't strand the cursor offscreen.
//
// Worktree branches use a folder-tree glyph and a compact chip beside the
// name. We avoid tinting the whole row so selection, hover, and status
// semantics don't compete for background colour.

import { useEffect, useRef } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { ArrowDown, ArrowUp, Check, FolderTree, GitBranch } from 'lucide-react'
import { useReposStore } from '#/renderer/stores/repos.ts'
import { useI18nStore, useT } from '#/renderer/stores/i18n.ts'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { BranchActionsMenu } from '#/renderer/components/BranchActionsMenu.tsx'
import { EmptyState } from '#/renderer/components/Layout.tsx'
import { useGhosttyInstalled } from '#/renderer/hooks/useGhosttyInstalled.ts'
import { useVSCodeInstalled } from '#/renderer/hooks/useVSCodeInstalled.ts'
import { cn } from '#/renderer/lib/cn.ts'
import { formatRelativeTime } from '#/renderer/lib/dates.ts'

interface Props {
  repoId: string
}

function Delta({ direction, count, label }: { direction: 'ahead' | 'behind'; count: number; label: string }) {
  const Icon = direction === 'ahead' ? ArrowUp : ArrowDown
  return (
    <span
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

export function BranchList({ repoId }: Props) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const selectBranch = useReposStore((s) => s.selectBranch)
  const selectedRef = useRef<HTMLLIElement | null>(null)
  const ghosttyInstalled = useGhosttyInstalled()
  const vscodeInstalled = useVSCodeInstalled()
  const { repo, branches, selected, current } = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      return {
        repo,
        branches: repo?.branches ?? [],
        selected: repo?.selectedBranch ?? null,
        current: repo?.currentBranch ?? '',
      }
    },
    (a, b) => a.repo === b.repo,
  )

  // Keep the selected row in view as the user navigates with j/k.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!repo) return null

  if (branches.length === 0) {
    return <EmptyState title={t('branches.empty')} />
  }

  return (
    <ul className="overflow-y-auto scroll-thin flex-1 divide-y divide-border">
      {branches.map((b) => {
        const isSelected = b.name === selected
        const isCurrent = b.name === current
        const hasWorktree = !!b.worktreePath
        const isWorktree = hasWorktree && !isCurrent
        return (
          <li
            key={b.name}
            ref={isSelected ? selectedRef : undefined}
            data-interactive
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            onClick={() => selectBranch(repoId, b.name)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                selectBranch(repoId, b.name)
              }
            }}
            className={cn(
              'grid cursor-pointer grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-2 px-4 py-2',
              // Keep the focus indicator inset so Tab navigation is
              // visible without painting an outside outline across the
              // row divider.
              'focus:outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
              // Selected is intentionally just a faint brand-tinted
              // surface: no marker, outline, or typography shift.
              'transition-colors duration-100',
              isSelected ? 'bg-selected text-selected-foreground hover:bg-selected' : 'hover:bg-muted',
            )}
          >
            <div className="flex size-4 shrink-0 items-center justify-center pt-0.5">
              {isCurrent ? (
                <Check size={14} className="text-success" />
              ) : isWorktree ? (
                <FolderTree size={14} className={b.worktreeDirty ? 'text-warning' : 'text-brand-text'} />
              ) : (
                <GitBranch size={14} className="text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-foreground">{b.name}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  {b.isDefault && (
                    <Badge variant="outline" className="font-mono text-muted-foreground">
                      {t('branches.default')}
                    </Badge>
                  )}
                  {hasWorktree && b.worktreeDirty ? (
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
                  {b.trackingGone && (
                    <Badge variant="warning" className="font-mono">
                      {t('branches.gone')}
                    </Badge>
                  )}
                  {b.ahead > 0 && (
                    <Delta direction="ahead" count={b.ahead} label={t('branch-status.sync.ahead', { n: b.ahead })} />
                  )}
                  {b.behind > 0 && (
                    <Delta direction="behind" count={b.behind} label={t('branch-status.sync.behind', { n: b.behind })} />
                  )}
                </div>
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">{b.lastCommitMessage || '—'}</span>
                <span className="shrink-0">{formatRelativeTime(b.lastCommitDate, lang)}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-start">
              <BranchActionsMenu
                repo={repo}
                branch={b}
                ghosttyInstalled={ghosttyInstalled}
                vscodeInstalled={vscodeInstalled}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
