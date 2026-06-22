import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { Switch } from '#/web/components/ui/switch.tsx'
import { canUseGlobalShortcutSettings } from '#/web/app-shell-client.ts'
import { SettingsCard, SettingsListItem } from '#/web/components/settings/SettingsPrimitives.tsx'
import { useShortcutSettingsController, useRuntimeShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import { useT } from '#/web/stores/i18n.ts'
import { cn } from '#/web/lib/cn.ts'
import { DEFAULT_GLOBAL_SHORTCUT, formatAccelerator, globalShortcutFromKeyboardEvent } from '#/shared/accelerator.ts'
export function ShortcutSettings() {
  const t = useT()
  const shortcutStatusId = 'global-shortcut-status'
  const { shortcutsDisabled, globalShortcutDisabled, globalShortcut, globalShortcutRegistered } =
    useRuntimeShortcutSettings()
  const { setShortcutsDisabled, setGlobalShortcutDisabled, setGlobalShortcut } = useShortcutSettingsController()
  const [recordingShortcut, setRecordingShortcut] = useState(false)
  const [shortcutError, setShortcutError] = useState<string | null>(null)
  const recordingShortcutRef = useRef(recordingShortcut)
  const globalShortcutSupported = canUseGlobalShortcutSettings()

  useEffect(() => {
    recordingShortcutRef.current = recordingShortcut
  }, [recordingShortcut])

  const saveGlobalShortcut = (accelerator: string) => {
    void setGlobalShortcut(accelerator).then((state) => {
      if (!state) {
        setShortcutError(t('settings.global-shortcut-conflict'))
        return
      }
      const failedToUseRequested = state.accelerator !== accelerator || (!globalShortcutDisabled && !state.registered)
      setShortcutError(failedToUseRequested ? t('settings.global-shortcut-conflict') : null)
    })
  }

  const recordGlobalShortcut = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recordingShortcut) return
    if (e.key === 'Tab') {
      setRecordingShortcut(false)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setRecordingShortcut(false)
      setShortcutError(null)
      return
    }
    const accelerator = globalShortcutFromKeyboardEvent(e.nativeEvent)
    if (!accelerator) {
      setShortcutError(t('settings.global-shortcut-invalid'))
      return
    }
    setRecordingShortcut(false)
    saveGlobalShortcut(accelerator)
  }

  const shortcutStatus = shortcutError
    ? { text: shortcutError, tone: 'error' as const }
    : !globalShortcutSupported
      ? { text: t('settings.global-shortcut-disabled-hint'), tone: 'muted' as const }
      : !globalShortcutDisabled && !globalShortcutRegistered
        ? { text: t('settings.global-shortcut-conflict'), tone: 'error' as const }
        : recordingShortcut
          ? { text: t('settings.global-shortcut-hint'), tone: 'muted' as const }
          : globalShortcutDisabled
            ? { text: t('settings.global-shortcut-disabled-hint'), tone: 'muted' as const }
            : null

  return (
    <SettingsCard>
      <SettingsListItem size="md">
        <label
          htmlFor="shortcuts-disabled-switch"
          className="min-w-0 cursor-pointer select-none text-sm text-foreground"
        >
          {t('settings.shortcuts-disable-app')}
        </label>
        <Switch
          id="shortcuts-disabled-switch"
          checked={shortcutsDisabled}
          onCheckedChange={(disabled) => void setShortcutsDisabled(disabled)}
          aria-label={t('settings.shortcuts-disable-app')}
        />
      </SettingsListItem>

      <SettingsListItem size="md">
        <label
          htmlFor="global-shortcut-disabled-switch"
          className="min-w-0 cursor-pointer select-none text-sm text-foreground"
        >
          {t('settings.shortcuts-disable-global')}
        </label>
        <Switch
          id="global-shortcut-disabled-switch"
          checked={globalShortcutDisabled}
          onCheckedChange={(disabled) => void setGlobalShortcutDisabled(disabled)}
          aria-label={t('settings.shortcuts-disable-global')}
          disabled={!globalShortcutSupported}
        />
      </SettingsListItem>

      <SettingsListItem size="md">
        <div className="min-w-0">
          <div className="truncate text-sm text-foreground">{t('settings.global-shortcut')}</div>
          <div id={shortcutStatusId} className="sr-only" aria-live="polite" role="status">
            {shortcutStatus?.text ?? ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            data-interactive
            variant="ghost"
            onClick={() => {
              if (!globalShortcutSupported) return
              setRecordingShortcut(true)
              setShortcutError(null)
            }}
            onKeyDown={recordGlobalShortcut}
            onBlur={() => setRecordingShortcut(false)}
            title={shortcutStatus?.text ?? t('settings.global-shortcut-record')}
            className={cn(
              'relative h-7 w-20 border px-2 font-mono text-[12px] font-normal leading-none shadow-[var(--shadow-control-inset-highlight)]',
              shortcutStatus?.tone === 'error'
                ? 'border-danger-border bg-danger-surface text-danger hover:bg-danger-surface'
                : recordingShortcut
                  ? 'border-primary/70 bg-primary/10 text-primary hover:bg-primary/15'
                  : 'border-border bg-muted/50 text-foreground hover:bg-accent',
            )}
            aria-label={t(recordingShortcut ? 'settings.global-shortcut-recording' : 'settings.global-shortcut-record')}
            aria-pressed={recordingShortcut}
            aria-describedby={shortcutStatusId}
            disabled={!globalShortcutSupported}
          >
            <span className="truncate">{formatAccelerator(globalShortcut)}</span>
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 size-2 rounded-full border border-background',
                shortcutStatus?.tone === 'error' ? 'bg-danger' : recordingShortcut ? 'bg-primary' : 'hidden',
              )}
            />
          </Button>
          <Button
            type="button"
            data-interactive
            variant="ghost"
            size="icon"
            onClick={() => saveGlobalShortcut(DEFAULT_GLOBAL_SHORTCUT)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t('settings.global-shortcut-reset')}
            title={t('settings.global-shortcut-reset')}
            disabled={!globalShortcutSupported}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </SettingsListItem>
    </SettingsCard>
  )
}
