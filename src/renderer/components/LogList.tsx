// Commit detail tab — `git log` for the selected branch. Refreshed on
// branch change and on tab switch, capped at 100 entries (any deeper
// dive belongs in the terminal). j/k moves the selection cursor; Enter
// (or click) opens the commit detail overlay.

import { useEffect, useRef } from 'react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useI18nStore, useT } from '#/renderer/stores/i18n.ts'
import { EmptyState } from '#/renderer/components/Layout.tsx'
import { cn } from '#/renderer/lib/cn.ts'
import { formatRelativeTime } from '#/renderer/lib/dates.ts'
import type { LogEntry } from '#/renderer/types.ts'

interface Props {
  repoId: string
  log: LogEntry[]
  branch: string
  selectedHash: string | null
}

export function LogList({ repoId, log, branch, selectedHash }: Props) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const openCommit = useReposStore((s) => s.openCommit)
  const selectLog = useReposStore((s) => s.selectLog)
  const selectedRef = useRef<HTMLLIElement | null>(null)

  // Keep the j/k cursor in view as the user navigates — same pattern
  // BranchList uses.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedHash])

  if (log.length === 0) {
    return <EmptyState title={branch ? t('log.empty-for-branch', { branch }) : t('log.empty')} />
  }
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <ul className="overflow-y-auto scroll-thin flex-1 divide-y divide-border">
        {log.map((entry) => {
          const isSelected = entry.hash === selectedHash
          return (
            <li
              key={entry.hash}
              ref={isSelected ? selectedRef : undefined}
              data-interactive
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onClick={() => {
                selectLog(repoId, branch, entry.hash)
                void openCommit(repoId, entry.hash)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  selectLog(repoId, branch, entry.hash)
                  void openCommit(repoId, entry.hash)
                }
              }}
              className={cn(
                'px-4 py-2.5 cursor-pointer transition-colors duration-100',
                'focus:outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
                isSelected ? 'bg-selected text-selected-foreground hover:bg-selected' : 'hover:bg-muted',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-brand-text shrink-0">{entry.shortHash}</span>
                <span className="truncate text-sm text-foreground">{entry.message}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {entry.author} · {formatRelativeTime(entry.date, lang)}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
