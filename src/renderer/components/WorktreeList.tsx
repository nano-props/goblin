// Worktrees tab — read-only listing of `git worktree list`. Each row
// shows the path, the branch checked out there, and a dirty indicator.
// Click → reveal in Finder, or open in Ghostty when installed. Future
// iterations could add `git worktree add/remove`.

import { useEffect, useState } from 'react'
import { Folder, FolderOpen, Terminal } from 'lucide-react'
import { useT } from '#/renderer/stores/i18n.ts'
import { cn } from '#/renderer/lib/cn.ts'
import type { WorktreeInfo } from '#/renderer/types.ts'

interface Props {
  worktrees: WorktreeInfo[]
}

export function WorktreeList({ worktrees }: Props) {
  const t = useT()
  // Probe ghostty once on mount. Cheap (existsSync over two paths in
  // main) and the result rarely changes mid-session — no need to
  // re-probe on every render or focus event.
  const [ghosttyInstalled, setGhosttyInstalled] = useState(false)
  useEffect(() => {
    let cancelled = false
    void window.gbl.ghosttyInstalled().then((ok) => {
      if (!cancelled) setGhosttyInstalled(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (worktrees.length === 0) {
    return <div className="p-6 text-center text-sm text-ink-3">{t('worktrees.empty')}</div>
  }
  return (
    <ul className="overflow-y-auto scroll-thin flex-1 divide-y divide-line">
      {worktrees.map((wt) => (
        <li key={wt.path} className="px-4 py-2.5 flex items-start gap-3">
          <div className="pt-0.5 text-ink-3 shrink-0">
            {wt.isDirty ? <FolderOpen size={14} className="text-warning" /> : <Folder size={14} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="truncate text-sm font-medium text-ink">{wt.branch ?? t('worktrees.detached')}</span>
              {wt.isBare && (
                <span className="rounded-sm border border-line-2 px-1 py-0 text-[10px] text-ink-3">
                  {t('worktrees.bare')}
                </span>
              )}
              {wt.isDirty && (
                <span
                  className={cn(
                    'rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    'bg-[rgb(var(--color-warning-rgb)/0.12)] text-warning',
                  )}
                >
                  {t('worktrees.dirtyCount', { n: wt.changeCount ?? '●' })}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-ink-3 truncate font-mono">{wt.path}</div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {ghosttyInstalled && (
              <button
                type="button"
                onClick={() => void window.gbl.openInGhostty(wt.path)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-2 bg-surface px-2.5 text-xs text-ink-2 hover:text-ink hover:bg-bg shadow-sm"
                title={t('worktrees.openInGhosttyTitle')}
                aria-label={t('worktrees.openInGhosttyTitle')}
              >
                <Terminal size={14} />
                <span>Ghostty</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void window.gbl.openInFinder(wt.path)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-2 bg-surface px-2.5 text-xs text-ink-2 hover:text-ink hover:bg-bg shadow-sm"
              title={t('worktrees.revealTitle')}
            >
              <FolderOpen size={14} />
              <span>{t('worktrees.reveal')}</span>
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
