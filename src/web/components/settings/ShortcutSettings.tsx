import { computed, defineComponent, ref } from 'vue'
import { RefreshCw } from '@lucide/vue'
import { Button } from '#/web/components/ui/button.tsx'
import { Switch } from '#/web/components/ui/switch.tsx'
import { canUseGlobalShortcutSettings } from '#/web/app-shell-client.ts'
import { SettingsCard, SettingsListItem } from '#/web/components/settings/SettingsPrimitives.tsx'
import { useShortcutSettingsController, useShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { cn } from '#/web/lib/cn.ts'
import { DEFAULT_GLOBAL_SHORTCUT, formatAccelerator, globalShortcutFromKeyboardEvent } from '#/shared/accelerator.ts'
export const ShortcutSettings = defineComponent({
  name: 'ShortcutSettings',
  setup() {
    const t = useT()
    const shortcutStatusId = 'global-shortcut-status'
    const shortcutSettings = useShortcutSettings()
    const { setShortcutsDisabled, setGlobalShortcutDisabled, setGlobalShortcut } = useShortcutSettingsController()
    const recordingShortcut = ref(false)
    const shortcutError = ref<string | null>(null)
    const globalShortcutSupported = canUseGlobalShortcutSettings()

    const saveGlobalShortcut = (accelerator: string) => {
      void setGlobalShortcut(accelerator).then((state) => {
        if (!state) {
          shortcutError.value = t('settings.global-shortcut-conflict')
          return
        }
        const failedToUseRequested =
          state.accelerator !== accelerator || (!shortcutSettings.value.globalShortcutDisabled && !state.registered)
        shortcutError.value = failedToUseRequested ? t('settings.global-shortcut-conflict') : null
      })
    }

    const recordGlobalShortcut = (e: KeyboardEvent) => {
      if (!recordingShortcut.value) return
      if (e.key === 'Tab') {
        recordingShortcut.value = false
        return
      }
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        recordingShortcut.value = false
        shortcutError.value = null
        return
      }
      const accelerator = globalShortcutFromKeyboardEvent(e)
      if (!accelerator) {
        shortcutError.value = t('settings.global-shortcut-invalid')
        return
      }
      recordingShortcut.value = false
      saveGlobalShortcut(accelerator)
    }

    const shortcutStatus = computed(() => {
      const settings = shortcutSettings.value
      return shortcutError.value
        ? { text: shortcutError.value, tone: 'error' as const }
        : !globalShortcutSupported
          ? { text: t('settings.global-shortcut-disabled-hint'), tone: 'muted' as const }
          : !settings.globalShortcutDisabled && !settings.globalShortcutRegistered
            ? { text: t('settings.global-shortcut-conflict'), tone: 'error' as const }
            : recordingShortcut.value
              ? { text: t('settings.global-shortcut-hint'), tone: 'muted' as const }
              : settings.globalShortcutDisabled
                ? { text: t('settings.global-shortcut-disabled-hint'), tone: 'muted' as const }
                : null
    })

    return () => {
      const settings = shortcutSettings.value
      const status = shortcutStatus.value
      const recordShortcutLabelKey = recordingShortcut.value
        ? 'settings.global-shortcut-recording'
        : 'settings.global-shortcut-record'
      return (
        <SettingsCard>
          <SettingsListItem size="md">
            <label for="shortcuts-disabled-switch" class="min-w-0 cursor-pointer select-none text-sm text-foreground">
              {t('settings.shortcuts-disable-app')}
            </label>
            <Switch
              id="shortcuts-disabled-switch"
              modelValue={settings.shortcutsDisabled}
              onUpdate:modelValue={(disabled) => void setShortcutsDisabled(disabled)}
              aria-label={t('settings.shortcuts-disable-app')}
            />
          </SettingsListItem>

          <SettingsListItem size="md">
            <label
              for="global-shortcut-disabled-switch"
              class="min-w-0 cursor-pointer select-none text-sm text-foreground"
            >
              {t('settings.shortcuts-disable-global')}
            </label>
            <Switch
              id="global-shortcut-disabled-switch"
              modelValue={settings.globalShortcutDisabled}
              onUpdate:modelValue={(disabled) => void setGlobalShortcutDisabled(disabled)}
              aria-label={t('settings.shortcuts-disable-global')}
              disabled={!globalShortcutSupported}
            />
          </SettingsListItem>

          <SettingsListItem size="md">
            <div class="min-w-0">
              <div class="truncate text-sm text-foreground">{t('settings.global-shortcut')}</div>
              <div id={shortcutStatusId} class="sr-only" aria-live="polite" role="status">
                {status?.text ?? ''}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                data-interactive
                variant="ghost"
                onClick={() => {
                  if (!globalShortcutSupported) return
                  recordingShortcut.value = true
                  shortcutError.value = null
                }}
                onKeydown={recordGlobalShortcut}
                onBlur={() => {
                  recordingShortcut.value = false
                }}
                title={status?.text ?? t('settings.global-shortcut-record')}
                class={cn(
                  'relative h-7 w-20 border px-2 font-mono text-[12px] font-normal leading-none shadow-[var(--shadow-control-inset-highlight)]',
                  status?.tone === 'error'
                    ? 'border-danger-border bg-danger-surface text-danger hover:bg-danger-surface'
                    : recordingShortcut.value
                      ? 'border-primary/70 bg-primary/10 text-primary hover:bg-primary/15'
                      : 'border-border bg-muted/50 text-foreground hover:bg-accent',
                )}
                aria-label={t(recordShortcutLabelKey)}
                aria-pressed={recordingShortcut.value}
                aria-describedby={shortcutStatusId}
                disabled={!globalShortcutSupported}
              >
                <span class="truncate">{formatAccelerator(settings.globalShortcut)}</span>
                <span
                  class={cn(
                    'absolute -right-0.5 -top-0.5 size-2 rounded-full border border-background',
                    status?.tone === 'error' ? 'bg-danger' : recordingShortcut.value ? 'bg-primary' : 'hidden',
                  )}
                />
              </Button>
              <Button
                type="button"
                data-interactive
                variant="ghost"
                size="icon"
                onClick={() => saveGlobalShortcut(DEFAULT_GLOBAL_SHORTCUT)}
                class="text-muted-foreground hover:text-foreground"
                aria-label={t('settings.global-shortcut-reset')}
                title={t('settings.global-shortcut-reset')}
                disabled={!globalShortcutSupported}
              >
                <RefreshCw class="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </SettingsListItem>
        </SettingsCard>
      )
    }
  },
})
