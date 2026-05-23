import { useState, type KeyboardEvent } from 'react'
import { Switch } from '#/renderer/components/ui/switch.tsx'
import { useT } from '#/renderer/stores/i18n.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import { cn } from '#/renderer/lib/cn.ts'
import { DEFAULT_GLOBAL_SHORTCUT, formatAccelerator, globalShortcutFromKeyboardEvent } from '#/shared/accelerator.ts'

export function ShortcutSettings() {
  const t = useT()
  const shortcutStatusId = 'global-shortcut-status'
  const shortcutsDisabled = useSettingsStore((s) => s.shortcutsDisabled)
  const setShortcutsDisabled = useSettingsStore((s) => s.setShortcutsDisabled)
  const globalShortcut = useSettingsStore((s) => s.globalShortcut)
  const globalShortcutRegistered = useSettingsStore((s) => s.globalShortcutRegistered)
  const setGlobalShortcut = useSettingsStore((s) => s.setGlobalShortcut)
  const [recordingShortcut, setRecordingShortcut] = useState(false)
  const [shortcutError, setShortcutError] = useState<string | null>(null)

  const saveShortcutsDisabled = (disabled: boolean) => {
    void setShortcutsDisabled(disabled).catch((err) => {
      console.warn('[settings] shortcuts update failed', err)
    })
  }

  const saveGlobalShortcut = (accelerator: string) => {
    void setGlobalShortcut(accelerator)
      .then((state) => {
        const failedToUseRequested = state.accelerator !== accelerator || (!shortcutsDisabled && !state.registered)
        setShortcutError(failedToUseRequested ? t('settings.global-shortcut-conflict') : null)
      })
      .catch((err) => {
        console.warn('[settings] global shortcut update failed', err)
        setShortcutError(t('settings.global-shortcut-conflict'))
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
    : !shortcutsDisabled && !globalShortcutRegistered
      ? { text: t('settings.global-shortcut-conflict'), tone: 'error' as const }
      : recordingShortcut
        ? { text: t('settings.global-shortcut-hint'), tone: 'muted' as const }
        : shortcutsDisabled
          ? { text: t('settings.global-shortcut-disabled-hint'), tone: 'muted' as const }
          : null

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex items-center justify-between gap-3 text-sm text-foreground">
        <label htmlFor="shortcuts-disabled-switch" className="cursor-pointer select-none">
          {t('settings.shortcuts-disable-all')}
        </label>
        <Switch
          id="shortcuts-disabled-switch"
          checked={shortcutsDisabled}
          onCheckedChange={saveShortcutsDisabled}
          aria-label={t('settings.shortcuts-disable-all')}
        />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-separator pt-2">
        <span className="text-sm text-foreground">{t('settings.global-shortcut')}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-interactive
            onClick={() => {
              setRecordingShortcut(true)
              setShortcutError(null)
            }}
            onKeyDown={recordGlobalShortcut}
            onBlur={() => setRecordingShortcut(false)}
            className="min-w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground transition-colors duration-100 hover:bg-accent"
            aria-label={t(recordingShortcut ? 'settings.global-shortcut-recording' : 'settings.global-shortcut-record')}
            aria-pressed={recordingShortcut}
            aria-describedby={shortcutStatusId}
          >
            {recordingShortcut ? t('settings.global-shortcut-recording') : formatAccelerator(globalShortcut)}
          </button>
          <button
            type="button"
            data-interactive
            onClick={() => saveGlobalShortcut(DEFAULT_GLOBAL_SHORTCUT)}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-foreground"
          >
            {t('settings.global-shortcut-reset')}
          </button>
        </div>
      </div>

      <div
        id={shortcutStatusId}
        className={cn(
          'h-4 truncate text-xs leading-4',
          shortcutStatus?.tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
        )}
        aria-live="polite"
        role="status"
      >
        {shortcutStatus?.text ?? '\u00A0'}
      </div>
    </div>
  )
}
