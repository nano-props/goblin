// Commit detail tab — `git log` for the selected branch. Refreshed on
// branch change and on tab switch, paged up to 300 entries (any deeper
// dive belongs in the terminal). j/k or arrows move the selection cursor; Enter
// (or click) opens the commit detail pane.

import { Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useI18nStore, useT } from '#/renderer/stores/i18n.ts'
import { EmptyState } from '#/renderer/components/Layout.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { cn } from '#/renderer/lib/cn.ts'
import { formatRelativeTime } from '#/renderer/lib/dates.ts'
import type { LogEntry } from '#/renderer/types.ts'

interface Props {
  repoId: string
  log: LogEntry[]
  branch: string
  selectedHash: string | null
  hasMore?: boolean
  loading?: boolean
}

export function LogList({ repoId, log, branch, selectedHash, hasMore = false, loading = false }: Props) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const openCommit = useReposStore((s) => s.openCommit)
  const selectLog = useReposStore((s) => s.selectLog)
  const loadMoreBranchLog = useReposStore((s) => s.loadMoreBranchLog)
  const selectedRef = useRef<HTMLLIElement | null>(null)

  // Keep the keyboard cursor in view as the user navigates — same pattern
  // BranchList uses.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedHash])

  if (log.length === 0) {
    return <EmptyState title={branch ? t('log.empty-for-branch', { branch }) : t('log.empty')} />
  }
  return (
    <div className="min-w-0 w-full">
      <ul className="min-w-0 w-full">
        {log.map((entry) => {
          const isSelected = entry.hash === selectedHash
          const commitMeta = `${entry.author} · ${formatRelativeTime(entry.date, lang)}`
          const message = entry.message || '—'
          return (
            <li
              key={entry.hash}
              ref={isSelected ? selectedRef : undefined}
              aria-current={isSelected ? 'true' : undefined}
              onClick={() => {
                selectLog(repoId, branch, entry.hash)
                void openCommit(repoId, entry.hash)
              }}
              className={cn(
                'min-w-0 px-4 py-2 cursor-pointer transition-colors duration-100',
                isSelected ? 'bg-selected text-selected-foreground hover:bg-selected' : 'hover:bg-muted',
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-mono text-xs text-brand-text shrink-0">{entry.shortHash}</span>
                <span
                  className={cn(
                    'min-w-0 truncate text-sm',
                    isSelected ? 'text-selected-foreground' : 'text-foreground',
                  )}
                  title={message}
                >
                  {message}
                </span>
                <span
                  className={cn(
                    'shrink-0 whitespace-nowrap text-xs',
                    isSelected ? 'text-selected-muted-foreground' : 'text-muted-foreground',
                  )}
                  title={commitMeta}
                >
                  {commitMeta}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
      {hasMore && (
        <div className="flex w-full justify-center border-t border-separator p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => void loadMoreBranchLog(repoId, branch)}
          >
            {loading && <Loader2 size={12} className="animate-spin" />}
            {loading ? t('log.loading-more') : t('log.load-more')}
          </Button>
        </div>
      )}
    </div>
  )
}
