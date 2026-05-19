// Log tab — `git log` for the currently selected branch. Refreshed on
// branch change and on tab switch, capped at 100 entries (any deeper
// dive belongs in the terminal). j/k moves the selection cursor;
// Enter (or click) opens the commit detail overlay.

import { useEffect, useRef } from 'react'
import { useReposStore } from '#/renderer/stores/repos.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { cn } from '#/renderer/lib/cn.ts'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import type { LogEntry } from '#/renderer/types.ts'

interface Props {
  repoId: string
  log: LogEntry[]
  branch: string
  selectedHash: string | null
}

export function LogList({ repoId, log, branch, selectedHash }: Props) {
  const t = useT()
  const openCommit = useReposStore((s) => s.openCommit)
  const selectLog = useReposStore((s) => s.selectLog)
  const selectedRef = useRef<HTMLLIElement | null>(null)

  // Keep the j/k cursor in view as the user navigates — same pattern
  // BranchList uses.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedHash])

  if (log.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        {branch && <LogBranchHint branch={branch} />}
        <div className="p-6 text-center text-sm text-muted-foreground">
          {branch ? t('log.emptyForBranch', { branch }) : t('log.empty')}
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {branch && <LogBranchHint branch={branch} />}
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
                selectLog(repoId, entry.hash)
                void openCommit(repoId, entry.hash)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  selectLog(repoId, entry.hash)
                  void openCommit(repoId, entry.hash)
                }
              }}
              className={cn(
                'px-4 py-2.5 cursor-pointer border-l-2 transition-colors duration-100 hover:bg-muted',
                'focus:outline-none focus-visible:outline-none',
                isSelected ? 'border-l-brand' : 'border-l-transparent',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-brand shrink-0">{entry.shortHash}</span>
                <span className="truncate text-sm text-foreground">{entry.message}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {entry.author} · {entry.date}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function LogBranchHint({ branch }: { branch: string }) {
  const t = useT()
  return (
    <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2 text-xs text-muted-foreground">
      <span>{t('log.showingBranch')}</span>
      <Badge variant="brand" className="max-w-full truncate font-mono">
        {branch}
      </Badge>
    </div>
  )
}
