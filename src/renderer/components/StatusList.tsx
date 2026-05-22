// Status detail tab — parsed `git status --porcelain` for the selected
// branch worktree. Entries use git's X (index) / Y (worktree)
// two-letter convention in the leading column, matching what users see
// in the terminal.

import { useT } from '#/renderer/stores/i18n.ts'
import { EmptyState, ScrollPane } from '#/renderer/components/Layout.tsx'
import { FilePathText } from '#/renderer/components/FilePathText.tsx'
import type { StatusEntry, WorktreeStatus } from '#/renderer/types.ts'

interface Props {
  status: WorktreeStatus[]
  emptyTitleKey?: string
  emptyBodyKey?: string
}

function isUnmergedStatus(entry: StatusEntry): boolean {
  return entry.x === 'U' || entry.y === 'U' || (entry.x === entry.y && (entry.x === 'A' || entry.x === 'D'))
}

function statusCodeClass(entry: StatusEntry, column: 'x' | 'y'): string {
  const code = column === 'x' ? entry.x : entry.y
  if (code === ' ' || !code) return 'text-transparent'
  if (code === '!') return 'text-muted-foreground'
  if (code === '?' || isUnmergedStatus(entry)) return 'text-danger'
  return column === 'x' ? 'text-success' : 'text-danger'
}

function StatusCode({ entry }: { entry: StatusEntry }) {
  return (
    <span
      className="inline-grid w-[2ch] shrink-0 grid-cols-[1ch_1ch] font-mono text-xs font-semibold leading-none"
      aria-label={`${entry.x}${entry.y}`}
    >
      <span className={statusCodeClass(entry, 'x')}>{entry.x === ' ' ? '\u00a0' : entry.x}</span>
      <span className={statusCodeClass(entry, 'y')}>{entry.y === ' ' ? '\u00a0' : entry.y}</span>
    </span>
  )
}

export function StatusList({
  status,
  emptyTitleKey = 'status.clean-title',
  emptyBodyKey = 'status.clean-body',
}: Props) {
  const t = useT()
  const totalEntries = status.reduce((n, w) => n + w.entries.length, 0)
  const dirtyWorktrees = status.filter((wt) => wt.entries.length > 0)

  if (totalEntries === 0) {
    return <EmptyState icon="✓" title={t(emptyTitleKey)} body={t(emptyBodyKey)} tone="success" />
  }

  return (
    <ScrollPane>
      {dirtyWorktrees.map((wt) => (
        <ul key={wt.path} className="divide-y divide-border border-b border-border last:border-b-0">
          {wt.entries.map((entry) => (
            <li
              key={`${wt.path}-${entry.path}`}
              className="grid grid-cols-[2ch_minmax(0,1fr)] items-center gap-4 px-4 py-2"
            >
              <StatusCode entry={entry} />
              <FilePathText path={entry.path} />
            </li>
          ))}
        </ul>
      ))}
    </ScrollPane>
  )
}
