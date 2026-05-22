import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import type { RepoEvent } from '#/renderer/stores/repos/types.ts'

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
        const description =
          hasMessage || !result.ok ? (
            <ToastDescription>{tRef.current(result.message || 'error.unknown')}</ToastDescription>
          ) : undefined
        if (result.ok) {
          toast.success(tRef.current('action.result-ok'), {
            id: `${repoId}:result:ok:${event.id}`,
            description,
          })
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
    <pre className="block max-h-32 w-full max-w-full min-w-0 overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-mono text-[11px] leading-relaxed scroll-thin">
      {children}
    </pre>
  )
}
