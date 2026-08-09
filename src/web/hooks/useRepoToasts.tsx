import { computed, defineComponent, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { toast } from 'vue-sonner'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import type { RepoEvent } from '#/web/stores/workspaces/types.ts'
import { repoEventActionSuccessLabel } from '#/web/stores/workspaces/action-labels.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import {
  hasWorktreeBootstrapSummaryDetails,
  type WorktreeBootstrapPathSummary,
  type WorktreeBootstrapSummary,
} from '#/shared/worktree-bootstrap-summary.ts'
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

export function useRepoToasts(repoId: MaybeRefOrGetter<WorkspaceId>) {
  const t = useT()
  const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
  const events = computed(() => {
    const workspace = workspaces.value[toValue(repoId)]
    return workspace?.capability.kind === 'git' ? workspace.capability.git.events : null
  })

  // Events are an external queue; drain each accepted store batch once.
  watch(
    events,
    (currentEvents) => {
      if (!currentEvents?.length) return
      const currentRepoId = toValue(repoId)
      for (const event of currentEvents) {
        if (event.kind === 'result') {
          const result = event.result
          const hasMessage = !!result.message
          const actionLabel = repoEventActionSuccessLabel(event.action)
          const resultMessageKey = result.message || 'error.unknown'
          const bootstrapSummary = formatTranslatedWorktreeBootstrapSummary(result.worktreeBootstrap, t)
          const translatedResultMessage = t(resultMessageKey)
          const translatedRecoveryMessages = (result.recoveryMessageKeys ?? []).map((recoveryMessageKey) =>
            t(recoveryMessageKey),
          )
          const descriptionText = repoResultDescription(
            result.ok,
            result.message,
            translatedResultMessage,
            translatedRecoveryMessages,
            bootstrapSummary,
          )
          const description =
            (!result.ok || (hasMessage && (!actionLabel || !!bootstrapSummary))) && descriptionText ? (
              <ToastDescription>{descriptionText}</ToastDescription>
            ) : undefined
          if (result.ok) {
            toast.success(actionLabel ? t(actionLabel.labelKey, actionLabel.labelParams) : t('action.result-ok'), {
              id: `${currentRepoId}:result:ok:${event.id}`,
              description,
            })
          } else {
            toast.error(t('action.result-error'), {
              id: `${currentRepoId}:result:err:${event.id}`,
              description,
              duration: 10_000,
            })
          }
        } else {
          toast.error(<ToastDescription>{t(event.message)}</ToastDescription>, {
            id: `${currentRepoId}:error:${event.id}`,
            duration: 10_000,
          })
        }
      }
      workspacesStore.getState().clearEvents(
        currentRepoId,
        currentEvents.map((event) => event.id),
      )
    },
    { immediate: true },
  )
}

function repoResultDescription(
  ok: boolean,
  rawResultMessage: string,
  translatedResultMessage: string,
  translatedRecoveryMessages: readonly string[],
  bootstrapSummary: string,
): string {
  if (ok) return bootstrapSummary || translatedResultMessage
  const resultMessage =
    rawResultMessage === 'cancelled' && translatedRecoveryMessages.length > 0 ? '' : translatedResultMessage
  return [resultMessage, ...translatedRecoveryMessages, bootstrapSummary].filter(Boolean).join('\n')
}

const ToastDescription = defineComponent({
  name: 'ToastDescription',
  setup(_props, { slots }) {
    return () => (
      <ScrollArea class="max-h-32 w-full max-w-full min-w-0" viewportClass="max-h-32">
        <pre class="block w-full max-w-full min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-mono text-[11px] leading-relaxed">
          {slots.default?.()}
        </pre>
      </ScrollArea>
    )
  },
})

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
