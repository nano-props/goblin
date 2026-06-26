import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { RepoEvent } from '#/web/stores/repos/types.ts'
import { repoEventActionSuccessLabel } from '#/web/stores/repos/action-labels.ts'
import { formatWorktreeBootstrapSummary } from '#/shared/worktree-bootstrap-summary.ts'
const EMPTY_EVENTS: RepoEvent[] = []

export function useRepoToasts(repoId: string) {
  const t = useT()
  const events = useReposStore((s) => s.repos[repoId]?.events ?? EMPTY_EVENTS)

  // `t` is read through a ref so a language flip doesn't re-fire these
  // effects (which would already be no-ops after the store clear, but
  // would still cost a render and obscure the dependency story).
  // Synced in render body so a toast fired in the same render as the
  // language switch picks up the new dict — an effect-based sync would
  // run a tick later and leave the ref one render stale.
  const tRef = useRef(t)
  tRef.current = t

  useEffect(() => {
    if (!events.length) return
    for (const event of events) {
      if (event.kind === 'result') {
        const result = event.result
        const hasMessage = !!result.message
        const actionLabel = repoEventActionSuccessLabel(event.action)
        const resultMessageKey = result.message || 'error.unknown'
        const bootstrapSummary = formatWorktreeBootstrapSummary(result.worktreeBootstrap)
        const descriptionText = bootstrapSummary || tRef.current(resultMessageKey)
        const description =
          (!result.ok || (hasMessage && (!actionLabel || !!bootstrapSummary))) && descriptionText ? (
            <ToastDescription>{descriptionText}</ToastDescription>
          ) : undefined
        if (result.ok) {
          toast.success(
            actionLabel
              ? tRef.current(actionLabel.labelKey, actionLabel.labelParams)
              : tRef.current('action.result-ok'),
            {
              id: `${repoId}:result:ok:${event.id}`,
              description,
            },
          )
        } else {
          toast.error(tRef.current('action.result-error'), {
            id: `${repoId}:result:err:${event.id}`,
            description,
            duration: 10_000,
          })
        }
      } else {
        toast.error(<ToastDescription>{tRef.current(event.message)}</ToastDescription>, {
          id: `${repoId}:error:${event.id}`,
          duration: 10_000,
        })
      }
    }
    useReposStore.getState().clearEvents(
      repoId,
      events.map((event) => event.id),
    )
  }, [events, repoId])
}

function ToastDescription({ children }: { children: React.ReactNode }) {
  return (
    <ScrollArea className="max-h-32 w-full max-w-full min-w-0" viewportClassName="max-h-32">
      <pre className="block w-full max-w-full min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-mono text-[11px] leading-relaxed">
        {children}
      </pre>
    </ScrollArea>
  )
}
