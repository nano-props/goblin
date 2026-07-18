import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { RepoEvent } from '#/web/stores/workspaces/types.ts'
import { repoEventActionSuccessLabel } from '#/web/stores/workspaces/action-labels.ts'
import {
  hasWorktreeBootstrapSummaryDetails,
  type WorktreeBootstrapPathSummary,
  type WorktreeBootstrapSummary,
} from '#/shared/worktree-bootstrap-summary.ts'
const EMPTY_EVENTS: RepoEvent[] = []

type Translator = ReturnType<typeof useT>
type WorktreeBootstrapSummaryPathKind = 'copy' | 'symlink' | 'hardlink' | 'skippedMissing'
type WorktreeBootstrapSummaryCountKind = 'one' | 'other'

const WORKTREE_BOOTSTRAP_PATH_SUMMARY_KEYS: Record<
  WorktreeBootstrapSummaryPathKind,
  Record<WorktreeBootstrapSummaryCountKind, string>
> = {
  copy: {
    one: 'worktree-bootstrap.summary.copy-one',
    other: 'worktree-bootstrap.summary.copy-other',
  },
  symlink: {
    one: 'worktree-bootstrap.summary.symlink-one',
    other: 'worktree-bootstrap.summary.symlink-other',
  },
  hardlink: {
    one: 'worktree-bootstrap.summary.hardlink-one',
    other: 'worktree-bootstrap.summary.hardlink-other',
  },
  skippedMissing: {
    one: 'worktree-bootstrap.summary.skipped-missing-one',
    other: 'worktree-bootstrap.summary.skipped-missing-other',
  },
}
const WORKTREE_BOOTSTRAP_MORE_SUFFIX_KEY = 'worktree-bootstrap.summary.more-suffix'
const WORKTREE_BOOTSTRAP_SETUP_KEY = 'worktree-bootstrap.summary.setup'

export function useRepoToasts(repoId: string) {
  const t = useT()
  const events = useWorkspacesStore((s) => s.workspaces[repoId]?.events ?? EMPTY_EVENTS)

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
        const bootstrapSummary = formatTranslatedWorktreeBootstrapSummary(result.worktreeBootstrap, tRef.current)
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
    useWorkspacesStore.getState().clearEvents(
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

function formatTranslatedWorktreeBootstrapSummary(
  summary: WorktreeBootstrapSummary | undefined,
  t: Translator,
): string {
  if (!summary || !hasWorktreeBootstrapSummaryDetails(summary)) return ''
  return [
    formatTranslatedPathSummary('copy', summary.copy, t),
    formatTranslatedPathSummary('symlink', summary.symlink, t),
    formatTranslatedPathSummary('hardlink', summary.hardlink, t),
    formatTranslatedPathSummary('skippedMissing', summary.skippedMissing, t),
    summary.setup ? t(WORKTREE_BOOTSTRAP_SETUP_KEY, { command: summary.setup.command }) : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function formatTranslatedPathSummary(
  kind: WorktreeBootstrapSummaryPathKind,
  summary: WorktreeBootstrapPathSummary,
  t: Translator,
): string {
  if (summary.count === 0) return ''
  const countKind: WorktreeBootstrapSummaryCountKind = summary.count === 1 ? 'one' : 'other'
  const summaryKey = WORKTREE_BOOTSTRAP_PATH_SUMMARY_KEYS[kind][countKind]
  const extraCount = summary.count - summary.paths.length
  const moreSuffix = extraCount > 0 ? t(WORKTREE_BOOTSTRAP_MORE_SUFFIX_KEY, { count: extraCount }) : ''
  return t(summaryKey, {
    count: summary.count,
    paths: summary.paths.join(', '),
    moreSuffix,
  })
}
