import { computed, defineComponent, ref, watch } from 'vue'
import { SelectRoot } from 'reka-ui'
import type { RemoteDiagnosticsResult, RemoteWorkspaceTarget, SshConfigHost } from '#/shared/remote-workspace.ts'
import { isResolvableRemotePathInput, remoteWorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import { isValidSshProfile } from '#/shared/workspace-locator.ts'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { RemoteDiagnosticsPanel } from '#/web/components/RemoteDiagnosticsPanel.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { DialogFooter } from '#/web/components/ui/dialog.tsx'
import { DirectoryPathSuggestions } from '#/web/components/ui/directory-path-suggestions.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '#/web/components/ui/field.tsx'
import { FormDialog } from '#/web/components/ui/form-dialog.tsx'
import { Input } from '#/web/components/ui/input.tsx'
import { SelectContent, SelectItem, SelectTrigger } from '#/web/components/ui/select.tsx'
import { SelectValue } from '#/web/components/ui/SelectValue.tsx'
import { useDirectoryPathSuggestions } from '#/web/hooks/useDirectoryPathSuggestions.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { cn } from '#/web/lib/cn.ts'
import { reportOpenWorkspacePostOpenEffects } from '#/web/lib/open-workspace-result-feedback.ts'
import {
  getRemoteSshHosts,
  resolveRemoteWorkspaceTarget,
  testRemoteWorkspaceConnection,
} from '#/web/remote-workspace-client.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const OpenRemoteWorkspaceDialog = defineComponent<Props>({
  name: 'OpenRemoteWorkspaceDialog',
  props: ['open', 'onOpenChange'],
  setup(props) {
    const t = useT()
    const compact = useIsCompactUi()
    const navigation = useAppNavigation()
    const hosts = ref<SshConfigHost[]>([])
    const hasInclude = ref(false)
    const alias = ref('')
    const remotePath = ref('')
    const diagnostics = ref<RemoteDiagnosticsResult | null>(null)
    const loading = ref(false)
    const loadError = ref<string | null>(null)
    const actionError = ref<string | null>(null)
    const pathSuggestionsOpen = ref(false)
    const hostInput = ref<HTMLInputElement | null>(null)
    const pathInput = ref<HTMLInputElement | null>(null)
    let openCycleController: AbortController | null = null
    const pathFieldErrorKey = computed(() =>
      remotePath.value.trim() ? remotePathError(remotePath.value).errorKey : null,
    )
    const canSubmit = computed(() =>
      canSubmitRemoteWorkspace({ alias: alias.value, remotePath: remotePath.value, pending: loading.value }),
    )
    const error = computed(() => actionError.value ?? loadError.value)
    const remotePathSuggestions = useDirectoryPathSuggestions({
      enabled: () => props.open && !loading.value,
      source: () => ({ kind: 'ssh', alias: alias.value }),
      prefix: remotePath,
    })

    // One open cycle owns every request and presentation update initiated by
    // this dialog. Closing or reopening revokes the old cycle atomically.
    watch(
      () => props.open,
      (open, _previous, onCleanup) => {
        if (!open) {
          openCycleController = null
          return
        }
        const controller = new AbortController()
        openCycleController = controller
        hosts.value = []
        hasInclude.value = false
        alias.value = ''
        remotePath.value = ''
        diagnostics.value = null
        loading.value = false
        loadError.value = null
        actionError.value = null
        void getRemoteSshHosts(controller.signal)
          .then((result) => {
            if (controller.signal.aborted) return
            hosts.value = result.hosts
            hasInclude.value = result.hasInclude
            alias.value = result.hasInclude ? '' : (result.hosts[0]?.alias ?? '')
          })
          .catch((caught) => {
            if (!controller.signal.aborted) loadError.value = formatRemoteDialogError(t, caught)
          })
        onCleanup(() => {
          controller.abort('remote-workspace-dialog-cycle-ended')
          if (openCycleController === controller) openCycleController = null
        })
      },
      { immediate: true },
    )

    // Focus follows the editable target after its DOM is committed. This also
    // restores focus after a pending test/open operation re-enables the form.
    watch(
      [() => props.open, loading, hasInclude, () => hosts.value.length],
      ([open, pending, include, hostCount]) => {
        if (!open || pending) return
        if (include) hostInput.value?.focus()
        else if (hostCount > 0) pathInput.value?.focus()
      },
      { flush: 'post' },
    )

    function clearResolvedRemoteState(): void {
      diagnostics.value = null
      actionError.value = null
    }

    async function resolveCurrentTarget(signal: AbortSignal): Promise<RemoteWorkspaceTarget | null> {
      const input = buildRemoteConnectionInput(alias.value, remotePath.value)
      if (!input) return null
      return resolveRemoteWorkspaceTarget(input, signal)
    }

    async function testConnection(): Promise<void> {
      const controller = openCycleController
      if (!canSubmit.value || !controller || controller.signal.aborted) return
      const { signal } = controller
      loading.value = true
      actionError.value = null
      try {
        const target = await resolveCurrentTarget(signal)
        if (!target) return
        const result = await testRemoteWorkspaceConnection(target, signal)
        if (!signal.aborted) diagnostics.value = result
      } catch (caught) {
        if (!signal.aborted) actionError.value = formatRemoteDialogError(t, caught)
      } finally {
        if (!signal.aborted) loading.value = false
      }
    }

    async function submit(): Promise<void> {
      const controller = openCycleController
      if (!canSubmit.value || !controller || controller.signal.aborted) return
      const { signal } = controller
      const onOpenChange = props.onOpenChange
      const admittedDiagnostics = diagnostics.value
      loading.value = true
      actionError.value = null
      try {
        const target = await resolveCurrentTarget(signal)
        if (!target) return
        const needsTest = !admittedDiagnostics?.ok || admittedDiagnostics.target.id !== target.id
        if (needsTest) {
          const result = await testRemoteWorkspaceConnection(target, signal)
          if (!remoteDiagnosticsAllowWorkspaceOpen(result)) {
            if (!signal.aborted) diagnostics.value = result
            return
          }
        }
        const openResult = await workspacesStore.getState().openWorkspaceMembership(remoteWorkspaceSessionEntry(target))
        if (signal.aborted) return
        if (!openResult.ok) {
          actionError.value = formatRemoteDialogError(t, openResult.message)
          return
        }
        navigation.activateWorkspace(openResult.workspaceId)
        reportOpenWorkspacePostOpenEffects(openResult, t, { descriptionPrefix: target.displayName })
        onOpenChange(false)
      } catch (caught) {
        if (!signal.aborted) actionError.value = formatRemoteDialogError(t, caught)
      } finally {
        if (!signal.aborted) loading.value = false
      }
    }

    function cancel(): void {
      if (!loading.value) props.onOpenChange(false)
    }

    return () => {
      const pathErrorKey = pathFieldErrorKey.value
      return (
        <FormDialog
          open={props.open}
          onOpenChange={(open) => {
            if (!open && !loading.value) cancel()
          }}
          showCloseButton={!loading.value}
          class="sm:max-w-xl"
          title={t('workspace-picker.open-remote-title')}
          description={t('workspace-picker.open-remote-description')}
          onEscapeKeyDown={(event) => {
            if (pathSuggestionsOpen.value) event.preventDefault()
          }}
        >
          <form
            class="space-y-3"
            onSubmit={(event: SubmitEvent) => {
              event.preventDefault()
              void submit()
            }}
          >
            <Field class="gap-2">
              <FieldLabel for="remote-ssh-host">{t('workspace-picker.open-remote-host-alias-label')}</FieldLabel>
              {hasInclude.value ? (
                <>
                  <Input
                    id="remote-ssh-host"
                    ref={(element) => {
                      hostInput.value = element instanceof HTMLInputElement ? element : null
                    }}
                    autofocus
                    disabled={loading.value}
                    value={alias.value}
                    onInput={(event: Event) => {
                      if (!(event.currentTarget instanceof HTMLInputElement)) return
                      alias.value = event.currentTarget.value
                      clearResolvedRemoteState()
                    }}
                    placeholder={hosts.value[0]?.alias ?? 'my-server'}
                    class="h-10 text-sm"
                    list={hosts.value.length > 0 ? 'remote-ssh-host-options' : undefined}
                    autocapitalize="off"
                    autocorrect="off"
                    spellcheck={false}
                  />
                  {hosts.value.length > 0 ? (
                    <datalist id="remote-ssh-host-options">
                      {hosts.value.map((item) => (
                        <option key={item.alias} value={item.alias} />
                      ))}
                    </datalist>
                  ) : null}
                  <FieldDescription>{t('workspace-picker.open-remote-include-manual-hint')}</FieldDescription>
                </>
              ) : hosts.value.length > 0 ? (
                <SelectRoot
                  modelValue={alias.value}
                  disabled={loading.value}
                  onUpdate:modelValue={(value) => {
                    if (typeof value !== 'string') return
                    alias.value = value
                    clearResolvedRemoteState()
                  }}
                >
                  <SelectTrigger id="remote-ssh-host" class="h-10 w-full text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {hosts.value.map((item) => (
                      <SelectItem key={item.alias} value={item.alias}>
                        {item.alias}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
              ) : (
                <Input id="remote-ssh-host" disabled value="" placeholder="my-server" class="h-10 text-sm" />
              )}
            </Field>

            <Field class="gap-2" data-invalid={pathErrorKey ? true : undefined}>
              <FieldLabel for="remote-path">{t('workspace-picker.open-remote-path-label')}</FieldLabel>
              <DirectoryPathSuggestions
                id="remote-path"
                inputRef={(element) => {
                  pathInput.value = element
                }}
                disabled={loading.value}
                value={remotePath.value}
                onChange={(nextPath) => {
                  remotePath.value = nextPath
                  clearResolvedRemoteState()
                }}
                suggestions={remotePathSuggestions.suggestions}
                isLoading={remotePathSuggestions.isLoading}
                hasFetched={remotePathSuggestions.hasFetched}
                emptyLabel={t('workspace-picker.open-remote-path-no-matches')}
                placeholder={t('workspace-picker.open-remote-path-placeholder')}
                aria-invalid={!!pathErrorKey}
                onPopupOpenChange={(open) => {
                  pathSuggestionsOpen.value = open
                }}
              />
              {pathErrorKey ? (
                <FieldError reserveHeight>{t(pathErrorKey)}</FieldError>
              ) : (
                <FieldDescription reserveHeight aria-hidden="true" />
              )}
            </Field>

            <RemoteDiagnosticsPanel
              diagnostics={diagnostics.value}
              error={error.value}
              loading={loading.value}
              idleText={
                !hasInclude.value && hosts.value.length === 0
                  ? t('workspace-picker.open-remote-config-required')
                  : t('workspace-picker.open-remote-diagnostics-idle-detail')
              }
            />

            <DialogFooter class="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                class={cn(compact.value && 'w-full')}
                disabled={loading.value}
                onClick={cancel}
              >
                {t('dialog.cancel')}
              </Button>
              <Button
                type="button"
                variant="outline"
                class={cn('min-w-24', compact.value && 'w-full min-w-0')}
                disabled={!canSubmit.value}
                onClick={() => void testConnection()}
              >
                {t('workspace-picker.open-remote-test-connection')}
              </Button>
              <Button
                type="submit"
                class={cn('min-w-28', compact.value && 'w-full min-w-0')}
                disabled={!canSubmit.value}
              >
                {t('workspace-picker.open-remote-confirm')}
              </Button>
            </DialogFooter>
          </form>
        </FormDialog>
      )
    }
  },
})

export function remoteDiagnosticsAllowWorkspaceOpen(result: Pick<RemoteDiagnosticsResult, 'stages'>): boolean {
  return result.stages.some((stage) => stage.name === 'path' && stage.status === 'passed')
}

export function remotePathError(value: string): { errorKey: string | null } {
  const trimmed = value.trim()
  if (!trimmed) return { errorKey: 'workspace-picker.open-remote-path-required' }
  if (!isResolvableRemotePathInput(trimmed)) return { errorKey: 'workspace-picker.open-remote-path-absolute' }
  return { errorKey: null }
}

export function canSubmitRemoteWorkspace(input: { alias: string; remotePath: string; pending: boolean }): boolean {
  if (input.pending || remotePathError(input.remotePath).errorKey) return false
  return isValidSshProfile(input.alias)
}

export function buildRemoteConnectionInput(alias: string, remotePath: string) {
  const cleanPath = remotePath.trim()
  if (remotePathError(cleanPath).errorKey) return null
  return isValidSshProfile(alias) ? { alias, remotePath: cleanPath } : null
}

export function formatRemoteDialogError(
  t: (key: string, params?: Record<string, string | number>) => string,
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('error.') || message.startsWith('workspace-picker.')) {
    const errorKey = message
    return t(errorKey)
  }
  return message
}
