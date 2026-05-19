// Status tab — parsed `git status --porcelain` for every worktree of
// the repo. Entries are grouped first by worktree (main worktree top),
// then within each worktree by Staged / Unstaged / Untracked using
// git's X (index) / Y (worktree) two-letter convention. The two-letter
// code is preserved verbatim in the leading column (matches what users
// see in the terminal); a friendlier word + colour chip sits beside it.

import { useState } from 'react'
import { ClipboardCopy, FolderOpen, FolderTree, Loader2 } from 'lucide-react'
import { useT } from '#/renderer/stores/i18n.ts'
import { useReposStore } from '#/renderer/stores/repos.ts'
import { Button } from '#/renderer/components/ui/button.tsx'
import { Badge, type BadgeVariant } from '#/renderer/components/ui/badge.tsx'
import { lastPathSegment, tildify } from '#/renderer/lib/paths.ts'
import type { StatusEntry, WorktreeStatus } from '#/renderer/types.ts'

interface Props {
  repoId: string
  status: WorktreeStatus[]
}

type LabelKey =
  | 'status.label.untracked'
  | 'status.label.ignored'
  | 'status.label.added'
  | 'status.label.deleted'
  | 'status.label.modified'
  | 'status.label.renamed'
  | 'status.label.copied'
  | 'status.label.conflict'
  | 'status.label.changed'

function statusLabel(x: string, y: string): { key: LabelKey; variant: BadgeVariant; raw?: string } {
  if (x === '?' && y === '?') return { key: 'status.label.untracked', variant: 'warning' }
  if (x === '!' && y === '!') return { key: 'status.label.ignored', variant: 'secondary' }
  if (x === 'A') return { key: 'status.label.added', variant: 'success' }
  if (x === 'D' || y === 'D') return { key: 'status.label.deleted', variant: 'destructive' }
  if (x === 'M' || y === 'M') return { key: 'status.label.modified', variant: 'warning' }
  if (x === 'R') return { key: 'status.label.renamed', variant: 'warning' }
  if (x === 'C') return { key: 'status.label.copied', variant: 'success' }
  if (x === 'U' || y === 'U') return { key: 'status.label.conflict', variant: 'destructive' }
  const raw = `${x}${y}`.trim()
  return { key: 'status.label.changed', variant: 'secondary', raw: raw || undefined }
}

interface Group {
  titleKey: string
  hintKey: string
  entries: StatusEntry[]
}

function groupStatus(entries: StatusEntry[]): Group[] {
  const staged: StatusEntry[] = []
  const unstaged: StatusEntry[] = []
  const untracked: StatusEntry[] = []
  for (const e of entries) {
    if (e.x === '?' && e.y === '?') {
      untracked.push(e)
    } else {
      if (e.x !== ' ' && e.x !== '?') staged.push(e)
      if (e.y !== ' ' && e.y !== '?') unstaged.push(e)
    }
  }
  const out: Group[] = []
  if (staged.length) out.push({ titleKey: 'status.staged', hintKey: 'status.stagedHint', entries: staged })
  if (unstaged.length) out.push({ titleKey: 'status.unstaged', hintKey: 'status.unstagedHint', entries: unstaged })
  if (untracked.length) out.push({ titleKey: 'status.untracked', hintKey: 'status.untrackedHint', entries: untracked })
  return out
}

export function StatusList({ repoId, status }: Props) {
  const t = useT()
  const setLastResult = useReposStore((s) => s.setLastResult)
  // Track which worktree's patch is currently being generated. We
  // store the path (not a boolean) so the spinner replaces the icon
  // only on the row the user actually clicked, while every other
  // copy button dims to discourage queueing — there's only one
  // clipboard, and concurrent patch generation would just race.
  const [copyingPath, setCopyingPath] = useState<string | null>(null)
  const totalEntries = status.reduce((n, w) => n + w.entries.length, 0)

  async function handleCopyPatch(worktreePath: string) {
    if (copyingPath) return
    setCopyingPath(worktreePath)
    try {
      const result = await window.gbl.patch(repoId, worktreePath)
      if (!result.ok) {
        setLastResult(repoId, { ok: false, message: result.message })
        return
      }
      if (!result.message) {
        setLastResult(repoId, { ok: false, message: 'status.copyPatchEmpty' })
        return
      }
      try {
        await navigator.clipboard.writeText(result.message)
      } catch (err) {
        setLastResult(repoId, { ok: false, message: err instanceof Error ? err.message : String(err) })
        return
      }
      setLastResult(repoId, { ok: true, message: 'status.copyPatchOk' })
    } catch (err) {
      setLastResult(repoId, { ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setCopyingPath(null)
    }
  }
  if (totalEntries === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <div>
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[rgb(var(--color-success-rgb)/0.1)] text-success">
            ✓
          </div>
          <div className="text-sm font-medium text-foreground">{t('status.cleanTitle')}</div>
          <div className="text-xs text-muted-foreground mt-1">{t('status.cleanBody')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-y-auto scroll-thin flex-1">
      {status.map((wt) => {
        const groups = groupStatus(wt.entries)
        const isClean = groups.length === 0
        const isCopyingThis = copyingPath === wt.path
        const displayPath = tildify(wt.path)
        // Disable every copy button while any patch is in flight —
        // generating a binary patch can take seconds, and clipboard is
        // a shared resource so a second click would just race.
        const copyDisabled = copyingPath !== null
        return (
          <section key={wt.path} className="border-b border-border last:border-b-0">
            <header
              className={`flex items-center justify-between gap-3 px-4 py-2 bg-muted ${isClean ? '' : 'border-b border-border'}`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {wt.isMain ? (
                  <FolderOpen size={13} className="text-brand shrink-0" />
                ) : (
                  <FolderTree size={13} className="text-muted-foreground shrink-0" />
                )}
                <span className="text-sm font-medium text-foreground truncate">
                  {wt.branch ?? lastPathSegment(wt.path)}
                </span>
                {wt.isMain && (
                  <Badge variant="outline" className="uppercase tracking-wide shrink-0">
                    {t('status.mainWorktree')}
                  </Badge>
                )}
                <span className="font-mono text-[11px] text-muted-foreground truncate min-w-0" title={displayPath}>
                  {displayPath}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!isClean && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleCopyPatch(wt.path)}
                    disabled={copyDisabled}
                    title={t('status.copyPatchTitle')}
                    aria-label={t('status.copyPatchTitle')}
                  >
                    {isCopyingThis ? <Loader2 size={11} className="animate-spin" /> : <ClipboardCopy size={11} />}
                    {t('status.copyPatch')}
                  </Button>
                )}
                <span className="text-xs text-muted-foreground font-mono">
                  {isClean ? t('status.worktreeClean') : wt.entries.length}
                </span>
              </div>
            </header>
            {!isClean &&
              groups.map((group) => (
                <section key={`${wt.path}-${group.titleKey}`} className="border-b border-border last:border-b-0">
                  <header className="flex items-baseline justify-between px-4 py-1.5 bg-background border-b border-border">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                        {t(group.titleKey)}
                      </span>
                      <span className="text-xs text-muted-foreground">{t(group.hintKey)}</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">{group.entries.length}</span>
                  </header>
                  <ul className="divide-y divide-border">
                    {group.entries.map((entry) => {
                      const label = statusLabel(entry.x, entry.y)
                      return (
                        <li
                          key={`${wt.path}-${group.titleKey}-${entry.path}`}
                          className="px-4 py-2 flex items-center gap-3"
                        >
                          <span className="font-mono text-xs text-muted-foreground shrink-0 w-7">
                            {entry.x}
                            {entry.y}
                          </span>
                          <Badge
                            variant={label.variant}
                            className="uppercase tracking-wide shrink-0 min-w-[68px] justify-center"
                          >
                            {label.raw ?? t(label.key)}
                          </Badge>
                          <span
                            className="truncate text-sm text-foreground font-mono flex-1 min-w-0"
                            title={entry.path}
                          >
                            {entry.path}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
          </section>
        )
      })}
    </div>
  )
}
