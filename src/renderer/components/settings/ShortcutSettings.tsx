import { useState, type KeyboardEvent } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '#/renderer/components/ui/button.tsx'
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
  const globalShortcutDisabled = useSettingsStore((s) => s.globalShortcutDisabled)
  const setGlobalShortcutDisabled = useSettingsStore((s) => s.setGlobalShortcutDisabled)
  const swapCloseShortcuts = useSettingsStore((s) => s.swapCloseShortcuts)
  const setSwapCloseShortcuts = useSettingsStore((s) => s.setSwapCloseShortcuts)
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

  const saveGlobalShortcutDisabled = (disabled: boolean) => {
    void setGlobalShortcutDisabled(disabled).catch((err) => {
      console.warn('[settings] global shortcut disabled update failed', err)
    })
  }

  const saveSwapCloseShortcuts = (swapped: boolean) => {
    void setSwapCloseShortcuts(swapped).catch((err) => {
      console.warn('[settings] swap close shortcuts update failed', err)
    })
  }

  const saveGlobalShortcut = (accelerator: string) => {
    void setGlobalShortcut(accelerator)
      .then((state) => {
        const failedToUseRequested = state.accelerator !== accelerator || (!globalShortcutDisabled && !state.registered)
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
    : !globalShortcutDisabled && !globalShortcutRegistered
      ? { text: t('settings.global-shortcut-conflict'), tone: 'error' as const }
      : recordingShortcut
        ? { text: t('settings.global-shortcut-hint'), tone: 'muted' as const }
        : globalShortcutDisabled
          ? { text: t('settings.global-shortcut-disabled-hint'), tone: 'muted' as const }
          : null

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-background/85 shadow-[var(--shadow-inset-highlight)]">
      <div className="flex min-h-11 items-center justify-between gap-4 px-3 py-2">
        <label
          htmlFor="shortcuts-disabled-switch"
          className="min-w-0 cursor-pointer select-none text-sm text-foreground"
        >
          {t('settings.shortcuts-disable-app')}
        </label>
        <Switch
          id="shortcuts-disabled-switch"
          checked={shortcutsDisabled}
          onCheckedChange={saveShortcutsDisabled}
          aria-label={t('settings.shortcuts-disable-app')}
        />
      </div>

      <div className="flex min-h-11 items-center justify-between gap-4 border-t border-separator px-3 py-2">
        <label
          htmlFor="global-shortcut-disabled-switch"
          className="min-w-0 cursor-pointer select-none text-sm text-foreground"
        >
          {t('settings.shortcuts-disable-global')}
        </label>
        <Switch
          id="global-shortcut-disabled-switch"
          checked={globalShortcutDisabled}
          onCheckedChange={saveGlobalShortcutDisabled}
          aria-label={t('settings.shortcuts-disable-global')}
        />
      </div>

      <div className="flex min-h-11 items-center justify-between gap-4 border-t border-separator px-3 py-2">
        <label
          htmlFor="swap-close-shortcuts-switch"
          className="min-w-0 cursor-pointer select-none text-sm text-foreground"
        >
          {t('settings.swap-close-shortcuts')}
        </label>
        <Switch
          id="swap-close-shortcuts-switch"
          checked={swapCloseShortcuts}
          onCheckedChange={saveSwapCloseShortcuts}
          aria-label={t('settings.swap-close-shortcuts')}
        />
      </div>

      <div className="flex min-h-11 items-center justify-between gap-4 border-t border-separator px-3 py-2">
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
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  )
}
