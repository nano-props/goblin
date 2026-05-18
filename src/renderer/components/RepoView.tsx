// Active-repo body. Header (name + path + actions) sits above a
// row of sub-tabs (Branches / Log / Status); transient
// success/error feedback surfaces as toasts (sonner) instead of
// inline banners so the layout doesn't shift. Each sub-tab body
// fills the remaining vertical space.

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { useReposStore, type RightTab } from '#/renderer/stores/repos.ts'
import { BranchList } from '#/renderer/components/BranchList.tsx'
import { LogList } from '#/renderer/components/LogList.tsx'
import { StatusList } from '#/renderer/components/StatusList.tsx'
import { CommitDetail } from '#/renderer/components/CommitDetail.tsx'
import { RepoActionsHeader } from '#/renderer/components/RepoActionsHeader.tsx'
import { ListSkeleton } from '#/renderer/components/Skeleton.tsx'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { useT } from '#/renderer/stores/i18n.ts'
import { cn } from '#/renderer/lib/cn.ts'

const TAB_KEYS: { id: RightTab; key: string; hotkey: string }[] = [
  { id: 'branches', key: 'tab.branches', hotkey: '⌘1' },
  { id: 'status', key: 'tab.status', hotkey: '⌘2' },
  { id: 'log', key: 'tab.log', hotkey: '⌘3' },
]

interface Props {
  repoId: string
}

export function RepoView({ repoId }: Props) {
  const t = useT()
  const repo = useReposStore((s) => s.repos[repoId])
  const setRightTab = useReposStore((s) => s.setRightTab)
  const setLastResult = useReposStore((s) => s.setLastResult)
  const setError = useReposStore((s) => s.setError)

  // `t` is read through a ref so a language flip doesn't re-fire these
  // effects (which would already be no-ops after the store clear, but
  // would still cost a render and obscure the dependency story).
  // Synced in render body so a toast fired in the same render as the
  // language switch picks up the new dict — an effect-based sync would
  // run a tick later and leave the ref one render stale.
  const tRef = useRef(t)
  tRef.current = t

  // Surface transient action results as toasts. Successes auto-dismiss
  // (sonner default ~4s); errors stay 10s — long enough to read multi-
  // line git output, short enough that retries don't pile up sticky
  // toasts in the corner. The toast id is keyed by repoId + kind so a
  // retry storm of failures collapses into a single error toast, while
  // a success that follows an error still pops a separate green toast
  // the user can see (rather than silently overwriting the red one).
  //
  // Race note: this effect's body runs synchronously, so within one
  // render tick we read `lastResult`, fire the toast, and clear the
  // store — no other dispatch can interleave. The only theoretical
  // loss is two store writes that batch into the *same* render: the
  // first value is then never observed. Actions are user-driven and
  // sequential in practice, so the simpler implementation wins.
  useEffect(() => {
    const result = repo?.lastResult
    if (!result) return
    // Wrap the description in a scrollable, max-height block: a long
    // git output (e.g. a merge with many file changes) would otherwise
    // grow the toast off-screen. A `<pre>` preserves git's leading-
    // whitespace formatting; the `max-h-32 overflow-y-auto` lets the
    // user mouse-scroll inside the toast for the rest.
    const message = result.message || 'error.unknown'
    const description = <ToastDescription>{tRef.current(message)}</ToastDescription>
    if (result.ok) {
      toast.success(tRef.current('action.resultOk'), {
        id: `${repoId}:result:ok`,
        description,
      })
    } else {
      toast.error(tRef.current('action.resultError'), {
        id: `${repoId}:result:err`,
        description,
        duration: 10_000,
      })
    }
    setLastResult(repoId, null)
  }, [repo?.lastResult, repoId, setLastResult])

  // repo.error is a translation-key OR raw string (mirrors lastResult).
  // Same dedupe-by-id strategy so a repo that keeps surfacing the same
  // error doesn't stack toasts. Wrap in the same scroll block so a long
  // stack trace doesn't push the toast off-screen.
  useEffect(() => {
    if (!repo?.error) return
    toast.error(<ToastDescription>{tRef.current(repo.error)}</ToastDescription>, {
      id: `${repoId}:error`,
      duration: 10_000,
    })
    setError(repoId, null)
  }, [repo?.error, repoId, setError])

  if (!repo) return <div />

  // Sum changes across every worktree so the status tab badge reflects
  // the full repo's dirtiness, not just the main worktree's.
  const statusCount = repo.status.reduce((n, w) => n + w.entries.length, 0)

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">{repo.name}</div>
            <div className="truncate text-xs text-muted-foreground">{repo.id}</div>
          </div>
          {repo.fetching && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" title={t('tab.fetchingTitle')}>
              <Loader2 size={12} className="animate-spin" />
              {t('tab.fetching')}
            </span>
          )}
          {!repo.fetching && repo.fetchFailed && (
            <span
              className="flex items-center gap-1 text-xs text-warning"
              // Hover surfaces the actual git error (e.g. "fatal: could
              // not read Username") so the user can act on it; without
              // a real message we fall back to the generic title.
              title={repo.fetchError ?? t('tab.fetchFailedTitle')}
              aria-label={repo.fetchError ?? t('tab.fetchFailedTitle')}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-warning" />
              {t('tab.fetchFailed')}
            </span>
          )}
        </div>
        <RepoActionsHeader repo={repo} />
      </header>

      <nav className="flex border-b border-border bg-muted px-2">
        {TAB_KEYS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setRightTab(repoId, tab.id)}
            title={tab.hotkey}
            className={cn(
              'h-9 px-3 text-sm border-b-2 -mb-px cursor-pointer transition-colors duration-100',
              repo.rightTab === tab.id
                ? 'border-brand text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(tab.key)}
            {tab.id === 'status' && statusCount > 0 && (
              <Badge variant="warning" className="ml-1.5 rounded-full">
                {statusCount}
              </Badge>
            )}
          </button>
        ))}
      </nav>

      <div className="flex flex-1 min-h-0 flex-col">
        {repo.openCommit ? (
          <CommitDetail repoId={repoId} detail={repo.openCommit} />
        ) : (
          <>
            {repo.rightTab === 'branches' &&
              (repo.loading && repo.branches.length === 0 ? (
                <ListSkeleton variant="branch" />
              ) : (
                <BranchList repo={repo} />
              ))}
            {repo.rightTab === 'log' &&
              (repo.log.length === 0 && repo.loading ? (
                <ListSkeleton variant="log" />
              ) : (
                <LogList
                  repoId={repoId}
                  log={repo.log}
                  branch={repo.selectedBranch ?? repo.currentBranch}
                  selectedHash={repo.selectedLogHash}
                />
              ))}
            {repo.rightTab === 'status' && <StatusList repoId={repoId} status={repo.status} />}
          </>
        )}
      </div>
    </section>
  )
}

function ToastDescription({ children }: { children: React.ReactNode }) {
  return (
    <pre className="block max-h-32 w-full max-w-full min-w-0 overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-mono text-[11px] leading-relaxed scroll-thin">
      {children}
    </pre>
  )
}
