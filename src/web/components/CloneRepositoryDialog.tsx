import { computed, defineComponent, ref, watch } from 'vue'
import type { CloneRepoResult } from '#/shared/api-types.ts'
import { chooseCloneParentPath, hasNativeDirectoryPicker, homeDirectory } from '#/web/app-shell-client.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { DialogFooter } from '#/web/components/ui/dialog.tsx'
import { DialogStatusRow } from '#/web/components/ui/dialog-status-row.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '#/web/components/ui/field.tsx'
import { FormDialog } from '#/web/components/ui/form-dialog.tsx'
import { Input } from '#/web/components/ui/input.tsx'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { cn } from '#/web/lib/cn.ts'
import { joinPath, tildify, untildify } from '#/web/lib/paths.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

export interface CloneRepositoryInput {
  url: string
  parentPath: string
  directoryName: string
}

interface Props {
  open: boolean
  onClose: () => void
  onClone: (input: CloneRepositoryInput, signal: AbortSignal) => Promise<CloneRepoResult>
}

export const CloneRepositoryDialog = defineComponent<Props>({
  name: 'CloneRepositoryDialog',
  props: ['open', 'onClose', 'onClone'],
  setup(props) {
    const t = useT()
    const compact = useIsCompactUi()
    const url = ref('')
    const parentPath = ref(tildify(defaultCloneParentPath()))
    const directoryName = ref('')
    const directoryTouched = ref(false)
    const pending = ref(false)
    const error = ref<string | null>(null)
    let dialogAbortController: AbortController | null = null
    const urlTrimmed = computed(() => url.value.trim())
    const parentPathTrimmed = computed(() => untildify(parentPath.value.trim()))
    const directoryNameTrimmed = computed(() => directoryName.value.trim())
    const directoryError = computed(() =>
      directoryNameTrimmed.value && !isValidDirectoryName(directoryNameTrimmed.value)
        ? t('workspace-picker.clone-directory-invalid')
        : '',
    )
    const effectivePath = computed(() =>
      parentPathTrimmed.value && directoryNameTrimmed.value && !directoryError.value
        ? tildify(joinPath(parentPathTrimmed.value, directoryNameTrimmed.value))
        : '',
    )
    const canSubmit = computed(
      () =>
        !!urlTrimmed.value &&
        !!parentPathTrimmed.value &&
        !!directoryNameTrimmed.value &&
        !directoryError.value &&
        !pending.value,
    )
    const canChooseParentPath = hasNativeDirectoryPicker()

    // The open dialog owns one abort scope for chooser and clone requests.
    watch(
      () => props.open,
      (open, _previous, onCleanup) => {
        if (!open) return
        const controller = new AbortController()
        dialogAbortController = controller
        url.value = ''
        parentPath.value = tildify(defaultCloneParentPath())
        directoryName.value = ''
        directoryTouched.value = false
        pending.value = false
        error.value = null
        onCleanup(() => {
          controller.abort()
          if (dialogAbortController === controller) dialogAbortController = null
        })
      },
      { immediate: true },
    )

    async function chooseParentPath(): Promise<void> {
      if (pending.value || !canChooseParentPath) return
      const signal = dialogAbortController?.signal
      if (!signal) return
      try {
        const selected = await chooseCloneParentPath({ signal })
        if (!signal.aborted && selected) parentPath.value = tildify(selected)
      } catch (caught) {
        if (!signal.aborted) error.value = caught instanceof Error ? caught.message : t('error.unknown')
      }
    }

    async function submit(): Promise<void> {
      if (!canSubmit.value || !dialogAbortController) return
      const controller = dialogAbortController
      const onClone = props.onClone
      const onClose = props.onClose
      const request = {
        url: urlTrimmed.value,
        parentPath: parentPathTrimmed.value,
        directoryName: directoryNameTrimmed.value,
      }
      pending.value = true
      error.value = null
      try {
        const result = await onClone(request, controller.signal)
        if (controller.signal.aborted) return
        pending.value = false
        if (result.ok) {
          onClose()
          return
        }
        const errorMessageKey = result.message || 'error.unknown'
        error.value = t(errorMessageKey)
      } catch (caught) {
        if (controller.signal.aborted) return
        pending.value = false
        error.value = caught instanceof Error ? caught.message : t('error.unknown')
      }
    }

    function cancel(): void {
      const controller = dialogAbortController
      dialogAbortController = null
      controller?.abort()
      pending.value = false
      props.onClose()
    }

    return () => (
      <FormDialog
        open={props.open}
        onOpenChange={(open) => {
          if (!open && !pending.value) cancel()
        }}
        showCloseButton={!pending.value}
        class="sm:max-w-xl"
        title={t('workspace-picker.clone-title')}
        description={t('workspace-picker.clone-description')}
      >
        <form
          class="space-y-4"
          onSubmit={(event: SubmitEvent) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Field class="gap-2">
            <FieldLabel for="clone-url">{t('workspace-picker.clone-url-label')}</FieldLabel>
            <Input
              id="clone-url"
              autofocus
              disabled={pending.value}
              value={url.value}
              onInput={(event: Event) => {
                if (!(event.currentTarget instanceof HTMLInputElement)) return
                const nextUrl = event.currentTarget.value
                url.value = nextUrl
                if (!directoryTouched.value) directoryName.value = directoryNameFromGitUrl(nextUrl.trim())
                error.value = null
              }}
              placeholder={t('workspace-picker.clone-url-placeholder')}
              class="h-10 font-mono text-sm"
            />
            <FieldDescription reserveHeight aria-hidden="true" />
          </Field>

          <Field class="gap-2">
            <FieldLabel for="clone-parent-path">{t('workspace-picker.clone-parent-label')}</FieldLabel>
            <div class={cn('gap-2', compact.value ? 'flex flex-col' : 'flex')}>
              <Input
                id="clone-parent-path"
                value={parentPath.value}
                onInput={(event: Event) => {
                  if (event.currentTarget instanceof HTMLInputElement) {
                    parentPath.value = event.currentTarget.value
                    error.value = null
                  }
                }}
                class="h-10 min-w-0 flex-1 font-mono text-sm"
                disabled={pending.value}
              />
              {canChooseParentPath ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending.value}
                  class={cn('h-10 self-stretch px-3', compact.value && 'w-full')}
                  onClick={() => void chooseParentPath()}
                >
                  {t('workspace-picker.clone-parent-choose')}
                </Button>
              ) : null}
            </div>
            <FieldDescription reserveHeight aria-hidden="true" />
          </Field>

          <Field class="gap-2" data-invalid={directoryError.value ? true : undefined}>
            <FieldLabel for="clone-directory-name">{t('workspace-picker.clone-directory-label')}</FieldLabel>
            <Input
              id="clone-directory-name"
              disabled={pending.value}
              value={directoryName.value}
              onInput={(event: Event) => {
                if (event.currentTarget instanceof HTMLInputElement) {
                  directoryName.value = event.currentTarget.value
                  directoryTouched.value = true
                  error.value = null
                }
              }}
              placeholder={t('workspace-picker.clone-directory-placeholder')}
              aria-invalid={!!directoryError.value}
              aria-describedby={directoryError.value ? 'clone-directory-error' : 'clone-path-preview'}
              class="h-10 font-mono text-sm"
            />
            {directoryError.value ? (
              <FieldError id="clone-directory-error" reserveHeight>
                {directoryError.value}
              </FieldError>
            ) : (
              <FieldDescription id="clone-path-preview" reserveHeight class="truncate">
                {effectivePath.value ? t('workspace-picker.clone-path-preview', { path: effectivePath.value }) : ''}
              </FieldDescription>
            )}
          </Field>

          <DialogStatusRow message={error.value ?? ''} tone="danger" />

          <DialogFooter class="gap-2 pt-2">
            <Button type="button" variant="outline" class={cn(compact.value && 'w-full')} onClick={cancel}>
              {t('dialog.cancel')}
            </Button>
            <Button type="submit" class={cn('min-w-28', compact.value && 'w-full min-w-0')} disabled={!canSubmit.value}>
              {pending.value ? t('workspace-picker.clone-cloning') : t('workspace-picker.clone-confirm')}
            </Button>
          </DialogFooter>
        </form>
      </FormDialog>
    )
  },
})

function directoryNameFromGitUrl(url: string): string {
  if (!url) return ''
  const withoutQuery = url.split(/[?#]/)[0]?.replace(/[/\\]+$/, '') ?? ''
  const start =
    Math.max(withoutQuery.lastIndexOf('/'), withoutQuery.lastIndexOf('\\'), withoutQuery.lastIndexOf(':')) + 1
  const name = withoutQuery.slice(start).replace(/\.git$/i, '')
  return name.replace(/[/\\:\0]+/g, '-').trim()
}

function isValidDirectoryName(name: string): boolean {
  return name.length > 0 && name.length <= 255 && name !== '.' && name !== '..' && !/[/\\:\0]/.test(name)
}

function defaultCloneParentPath(): string {
  return joinPath(homeDirectory(), 'Developer')
}
