// Status detail tab — parsed `git status --porcelain` for the selected
// branch worktree. Entries are grouped by Staged / Unstaged / Untracked
// using git's X (index) / Y (worktree) two-letter convention. The
// two-letter code is preserved verbatim in the leading column (matches
// what users see in the terminal); a friendlier word + colour chip sits
// beside it.

import { useT } from '#/renderer/stores/i18n.ts'
import { Badge, type BadgeVariant } from '#/renderer/components/ui/badge.tsx'
import { EmptyState, ScrollPane } from '#/renderer/components/Layout.tsx'
import type { StatusEntry, WorktreeStatus } from '#/renderer/types.ts'

interface Props {
  status: WorktreeStatus[]
  emptyTitleKey?: string
  emptyBodyKey?: string
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

function statusLabel(code: string): { key: LabelKey; variant: BadgeVariant; raw?: string } {
  if (code === '?') return { key: 'status.label.untracked', variant: 'warning' }
  if (code === '!') return { key: 'status.label.ignored', variant: 'secondary' }
  if (code === 'A') return { key: 'status.label.added', variant: 'success' }
  if (code === 'D') return { key: 'status.label.deleted', variant: 'destructive' }
  if (code === 'M') return { key: 'status.label.modified', variant: 'warning' }
  if (code === 'R') return { key: 'status.label.renamed', variant: 'warning' }
  if (code === 'C') return { key: 'status.label.copied', variant: 'success' }
  if (code === 'U') return { key: 'status.label.conflict', variant: 'destructive' }
  const raw = code.trim()
  return { key: 'status.label.changed', variant: 'secondary', raw: raw || undefined }
}

type GroupKind = 'staged' | 'unstaged' | 'untracked'

interface Group {
  kind: GroupKind
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
  if (staged.length)
    out.push({ kind: 'staged', titleKey: 'status.staged', hintKey: 'status.stagedHint', entries: staged })
  if (unstaged.length)
    out.push({ kind: 'unstaged', titleKey: 'status.unstaged', hintKey: 'status.unstagedHint', entries: unstaged })
  if (untracked.length)
    out.push({ kind: 'untracked', titleKey: 'status.untracked', hintKey: 'status.untrackedHint', entries: untracked })
  return out
}

function groupCode(group: GroupKind, entry: StatusEntry): string {
  if (group === 'staged') return entry.x
  if (group === 'unstaged') return entry.y
  return '?'
}

export function StatusList({ status, emptyTitleKey = 'status.cleanTitle', emptyBodyKey = 'status.cleanBody' }: Props) {
  const t = useT()
  const totalEntries = status.reduce((n, w) => n + w.entries.length, 0)

  if (totalEntries === 0) {
    return <EmptyState icon="✓" title={t(emptyTitleKey)} body={t(emptyBodyKey)} tone="success" />
  }

  return (
    <ScrollPane>
      {status.map((wt) => {
        const groups = groupStatus(wt.entries)
        return (
          <div key={wt.path}>
            {groups.map((group) => (
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
                    const label = statusLabel(groupCode(group.kind, entry))
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
                        <span className="truncate text-sm text-foreground font-mono flex-1 min-w-0" title={entry.path}>
                          {entry.path}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )
      })}
    </ScrollPane>
  )
}
