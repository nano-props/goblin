// Persistent branch list. Each row shows branch name, upstream,
// ahead/behind, optional worktree marker, and the head commit's hash +
// subject + author + relative date. The selected row scrolls into view
// automatically when the user moves with j/k so a long branch list
// doesn't strand the cursor offscreen.
//
// Worktree branches use a folder-tree glyph and a path chip beside the
// name. We avoid tinting the whole row so selection, hover, and status
// semantics don't compete for background colour.

import { useEffect, useRef } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { ArrowDown, ArrowUp, Check, FolderTree, GitBranch } from 'lucide-react'
import { useReposStore } from '#/renderer/stores/repos.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { EmptyState } from '#/renderer/components/Layout.tsx'
import { cn } from '#/renderer/lib/cn.ts'
import { lastPathSegment, tildify } from '#/renderer/lib/paths.ts'

interface Props {
  repoId: string
}

export function BranchList({ repoId }: Props) {
  const t = useT()
  const selectBranch = useReposStore((s) => s.selectBranch)
  const selectedRef = useRef<HTMLLIElement | null>(null)
  const { branches, selected, current } = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      return {
        branches: repo?.branches ?? [],
        selected: repo?.selectedBranch ?? null,
        current: repo?.currentBranch ?? '',
      }
    },
    (a, b) => a.branches === b.branches && a.selected === b.selected && a.current === b.current,
  )

  // Keep the selected row in view as the user navigates with j/k.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (branches.length === 0) {
    return <EmptyState title={t('branches.empty')} />
  }

  return (
    <ul className="overflow-y-auto scroll-thin flex-1 divide-y divide-border">
      {branches.map((b) => {
        const isSelected = b.name === selected
        const isCurrent = b.name === current
        const isWorktree = !!b.worktreePath && !isCurrent
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
              'flex cursor-pointer items-start gap-2 px-4 py-2.5',
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
            <div className="w-4 pt-0.5 shrink-0">
              {isCurrent ? (
                <Check size={14} className="text-success" />
              ) : isWorktree ? (
                <FolderTree size={14} className="text-muted-foreground" />
              ) : (
                <GitBranch size={14} className="text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="truncate font-medium text-foreground">{b.name}</span>
                {b.isDefault && (
                  <Badge variant="outline" className="font-mono leading-4 text-muted-foreground">
                    {t('branches.default')}
                  </Badge>
                )}
                {isWorktree && b.worktreePath && (
                  <Badge
                    variant={b.worktreeDirty ? 'warning' : 'brand'}
                    className="gap-1"
                    title={tildify(b.worktreePath)}
                  >
                    <FolderTree size={10} />
                    {lastPathSegment(b.worktreePath)}
                    {b.worktreeDirty && <span className="ml-0.5 uppercase tracking-wide">· {t('branches.dirty')}</span>}
                  </Badge>
                )}
                {b.tracking ? (
                  <Badge
                    variant="outline"
                    className={cn('font-mono leading-4', b.trackingGone && 'text-warning border-warning-border')}
                  >
                    {b.trackingGone ? `${b.tracking} (${t('branches.gone')})` : b.tracking}
                  </Badge>
                ) : (
                  // Surface "no upstream" as plain text rather than a
                  // bare warning glyph: the icon alone gives users no
                  // way to learn what it means without hovering.
                  <Badge variant="outline" className="font-mono leading-4 text-muted-foreground">
                    {t('branches.noUpstream')}
                  </Badge>
                )}
                {b.ahead > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-success">
                    <ArrowUp size={11} />
                    {b.ahead}
                  </span>
                )}
                {b.behind > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-warning">
                    <ArrowDown size={11} />
                    {b.behind}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono shrink-0">{b.lastCommitHash}</span>
                <span className="truncate">{b.lastCommitMessage || '—'}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {b.lastCommitAuthor} · {b.lastCommitDate}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
