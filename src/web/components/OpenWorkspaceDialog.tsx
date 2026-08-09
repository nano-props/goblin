import { computed, defineComponent, ref, watch } from 'vue'
import type { OpenWorkspaceResult } from '#/web/stores/workspaces/types.ts'
import { chooseLocalWorkspacePath, hasNativeDirectoryPicker } from '#/web/app-shell-client.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { DialogFooter } from '#/web/components/ui/dialog.tsx'
import { DialogStatusRow } from '#/web/components/ui/dialog-status-row.tsx'
import { DirectoryPathSuggestions } from '#/web/components/ui/directory-path-suggestions.tsx'
import { Field, FieldLabel } from '#/web/components/ui/field.tsx'
import { FormDialog } from '#/web/components/ui/form-dialog.tsx'
import { useDirectoryPathSuggestions } from '#/web/hooks/useDirectoryPathSuggestions.ts'
import { useLatestAsyncTask } from '#/web/hooks/useLatestAsyncTask.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { cn } from '#/web/lib/cn.ts'
import { reportOpenWorkspacePostOpenEffects } from '#/web/lib/open-workspace-result-feedback.ts'
import { tildify, untildify } from '#/web/lib/paths.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

interface Props {
  open: boolean
  onClose: () => void
  onOpen: (path: string, signal: AbortSignal) => Promise<OpenWorkspaceResult>
}

export const OpenWorkspaceDialog = defineComponent<Props>({
  name: 'OpenWorkspaceDialog',
  props: ['open', 'onClose', 'onOpen'],
  setup(props) {
    const t = useT()
    const compact = useIsCompactUi()
    const path = ref('')
    const error = ref<string | null>(null)
    const pathSuggestionsOpen = ref(false)
    const { pending, reset, runLatest } = useLatestAsyncTask()
    let dialogAbortController: AbortController | null = null
    const resolvedPath = computed(() => untildify(path.value))
    const canSubmit = computed(() => path.value.trim().length > 0 && !pending.value)
    const canChoosePath = hasNativeDirectoryPicker()
    const pathSuggestions = useDirectoryPathSuggestions({
      enabled: () => props.open && !pending.value,
      source: { kind: 'local' },
      prefix: path,
    })

    // The open dialog owns the chooser and open-workspace request lifetime.
    watch(
      () => props.open,
      (open, _previous, onCleanup) => {
        if (!open) return
        const controller = new AbortController()
        dialogAbortController = controller
        path.value = ''
        reset()
        error.value = null
        onCleanup(() => {
          controller.abort()
          if (dialogAbortController === controller) dialogAbortController = null
        })
      },
      { immediate: true },
    )

    async function choosePath(): Promise<void> {
      if (pending.value || !canChoosePath) return
      const signal = dialogAbortController?.signal
      if (!signal) return
      try {
        const selected = await chooseLocalWorkspacePath({ signal })
        if (!signal.aborted && selected) {
          path.value = tildify(selected)
          error.value = null
        }
      } catch (caught) {
        if (!signal.aborted) error.value = caught instanceof Error ? caught.message : t('error.unknown')
      }
    }

    async function submit(): Promise<void> {
      if (!canSubmit.value) return
      const signal = dialogAbortController?.signal
      if (!signal) return
      const onOpen = props.onOpen
      const onClose = props.onClose
      const pathToOpen = resolvedPath.value
      error.value = null
      try {
        const result = await runLatest(() => onOpen(pathToOpen, signal))
        if (signal.aborted || result.status === 'stale') return
        if (result.value.ok) {
          reportOpenWorkspacePostOpenEffects(result.value, t)
          onClose()
          return
        }
        const messageKey = result.value.message
        error.value = t(messageKey)
      } catch (caught) {
        if (!signal.aborted) error.value = caught instanceof Error ? caught.message : t('error.unknown')
      }
    }

    function cancel(): void {
      const controller = dialogAbortController
      dialogAbortController = null
      controller?.abort()
      props.onClose()
    }

    return () => (
      <FormDialog
        open={props.open}
        onOpenChange={(open) => {
          if (!open && !pending.value) cancel()
        }}
        showCloseButton={!pending.value}
        title={t('workspace-picker.open-title')}
        description={t('workspace-picker.open-description')}
        onEscapeKeyDown={(event) => {
          if (pathSuggestionsOpen.value) event.preventDefault()
        }}
      >
        <form
          class="space-y-0"
          onSubmit={(event: SubmitEvent) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Field>
            <FieldLabel for="open-workspace-path">{t('workspace-picker.open-path-label')}</FieldLabel>
            <div class={cn('gap-2', compact.value ? 'flex flex-col' : 'flex')}>
              <DirectoryPathSuggestions
                id="open-workspace-path"
                autofocus
                disabled={pending.value}
                value={path.value}
                onChange={(nextPath) => {
                  path.value = nextPath
                  error.value = null
                }}
                suggestions={pathSuggestions.suggestions}
                isLoading={pathSuggestions.isLoading}
                hasFetched={pathSuggestions.hasFetched}
                emptyLabel={t('workspace-picker.open-path-no-matches')}
                placeholder={t('workspace-picker.open-path-placeholder')}
                class="min-w-0 flex-1"
                inputClass="text-xs"
                onPopupOpenChange={(open) => {
                  pathSuggestionsOpen.value = open
                }}
              />
              {canChoosePath ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending.value}
                  class={cn('h-auto self-stretch px-3', compact.value && 'w-full')}
                  onClick={() => void choosePath()}
                >
                  {t('workspace-picker.open-path-choose')}
                </Button>
              ) : null}
            </div>
            <DialogStatusRow message={error.value ?? ''} tone={error.value ? 'danger' : 'default'} />
          </Field>

          <DialogFooter class="pt-4">
            <Button
              type="button"
              variant="outline"
              class={cn(compact.value && 'w-full')}
              disabled={pending.value}
              onClick={cancel}
            >
              {t('dialog.cancel')}
            </Button>
            <Button type="submit" class={cn(compact.value && 'w-full')} disabled={!canSubmit.value}>
              {pending.value ? t('workspace-picker.open-opening') : t('workspace-picker.open-local-confirm')}
            </Button>
          </DialogFooter>
        </form>
      </FormDialog>
    )
  },
})
