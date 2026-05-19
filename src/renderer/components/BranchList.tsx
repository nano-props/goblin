// Branches tab — the primary right-side view. Each row shows branch
// name, upstream, ahead/behind, optional worktree marker, and the head
// commit's hash + subject + author + relative date. The selected row
// scrolls into view automatically when the user moves with j/k so a
// long branch list doesn't strand the cursor offscreen.
//
// Worktree branches are visually distinct: the row's leading icon is
// replaced with a folder-tree glyph in accent color, and a coloured
// chip beside the name spells out the worktree path tail. This makes
// "this branch is checked out elsewhere" readable at a glance — the
// previous design buried the marker inside a row of small chips.

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, FolderTree, GitBranch } from 'lucide-react'
import { useReposStore, type RepoState } from '#/renderer/stores/repos.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { BranchActionsMenu } from '#/renderer/components/BranchActionsMenu.tsx'
import { cn } from '#/renderer/lib/cn.ts'
import { lastPathSegment, tildify } from '#/renderer/lib/paths.ts'

interface Props {
  repo: RepoState
}

export function BranchList({ repo }: Props) {
  const t = useT()
  const selectBranch = useReposStore((s) => s.selectBranch)
  const selectedRef = useRef<HTMLLIElement | null>(null)
  const branches = repo.branches
  const selected = repo.selectedBranch
  const current = repo.currentBranch

  // Probe ghostty once. Cheap and doesn't change mid-session, so a
  // mount-time check is enough. The result is threaded into every
  // BranchActionsMenu so the menu can show / hide its Ghostty entry.
  const [ghosttyInstalled, setGhosttyInstalled] = useState(false)
  useEffect(() => {
    let cancelled = false
    void window.gbl
      .ghosttyInstalled()
      .then((ok) => {
        if (!cancelled) setGhosttyInstalled(ok)
      })
      .catch((err) => {
        console.warn('[ghosttyInstalled] failed', err)
        if (!cancelled) setGhosttyInstalled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Keep the selected row in view as the user navigates with j/k.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (branches.length === 0) {
    return <div className="p-6 text-center text-sm text-muted-foreground">{t('branches.empty')}</div>
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
            onClick={() => selectBranch(repo.id, b.name)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                selectBranch(repo.id, b.name)
              }
            }}
            className={cn(
              'flex cursor-pointer items-start gap-2 px-4 py-2.5 border-l-2',
              // No focus ring on the row itself: the j/k keyboard
              // navigator already updates `selected`, so the selected
              // visual (bg-muted + border-brand) doubles as the focus
              // indicator. The global :focus-visible rule in styles.css
              // would otherwise paint a 2px outline around the row,
              // which renders as a blue line along the bottom edge
              // (the only edge not visually absorbed by the row's own
              // surface) — outline goes outside the box, so adjacent
              // rows get a stray brand-coloured separator.
              'focus:outline-none focus-visible:outline-none',
              // `border-l-brand` (not `border-brand`) so we only set the
              // colour of the left edge: the parent <ul> uses
              // `divide-y divide-border` which paints a 1px bottom
              // border on every row except the last. That bottom
              // border picks up its colour from `border-color`. If we
              // set `border-brand` (the shorthand for all 4 edges),
              // it overrides the divide-border colour and the row's
              // own bottom-divider goes brand-blue — visible as a
              // stray blue line under the selected row.
              // Selected = left brand bar (current branch has its own ✓
              // glyph elsewhere in the row). row-hover paints bg-muted;
              // the BranchActionsMenu button inside uses bg-accent on
              // its own hover, and accent is now one step deeper than
              // muted in the token layer so hover-on-hover still reads.
              'transition-colors duration-100',
              isSelected ? 'border-l-brand hover:bg-muted' : 'border-l-transparent hover:bg-muted',
              // Worktree rows get a faint brand-tinted background so
              // the eye groups them away from "normal" branches. Single
              // tint regardless of selected state — the left brand bar
              // (set above) already tells the user which row is selected.
              isWorktree && 'bg-[rgb(var(--color-brand-rgb)/0.05)]',
            )}
          >
            <div className="w-4 pt-0.5 shrink-0">
              {isCurrent ? (
                <Check size={14} className="text-success" />
              ) : isWorktree ? (
                <FolderTree size={14} className="text-brand" />
              ) : (
                <GitBranch size={14} className="text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="truncate font-medium text-foreground">{b.name}</span>
                {b.isDefault && (
                  <Badge variant="brand" className="font-mono leading-4">
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
                    className={cn(
                      'font-mono leading-4',
                      b.trackingGone && 'text-warning border-[rgb(var(--color-warning-rgb)/0.4)]',
                    )}
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
              <div className="mt-0.5 text-xs text-muted-foreground/60">
                {b.lastCommitAuthor} · {b.lastCommitDate}
              </div>
            </div>
            <div className="shrink-0 flex items-start gap-1 pt-0.5">
              <BranchActionsMenu repo={repo} branch={b} ghosttyInstalled={ghosttyInstalled} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
