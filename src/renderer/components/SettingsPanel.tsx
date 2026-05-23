// Settings overlay — theme pref, language, auto-fetch interval, shortcuts.
// Mounted unconditionally and gated by `open`; the modal itself
// returns null when closed.

import { Laptop, Moon, Sun } from 'lucide-react'
import { Modal } from '#/renderer/components/Modal.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/renderer/components/ui/select.tsx'
import { ShortcutSettings } from '#/renderer/components/settings/ShortcutSettings.tsx'
import { useThemeStore } from '#/renderer/stores/theme.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import { useI18nStore, useT } from '#/renderer/stores/i18n.ts'
import type { LangPref, ThemePref } from '#/renderer/types-bridge.ts'
import { rpc } from '#/renderer/rpc.ts'

interface Props {
  open: boolean
  onClose: () => void
}

export function SettingsPanel({ open, onClose }: Props) {
  const t = useT()
  const themePref = useThemeStore((s) => s.pref)
  const setThemePref = useThemeStore((s) => s.setPref)
  const langPref = useI18nStore((s) => s.pref)
  const setLangPref = useI18nStore((s) => s.setPref)
  const fetchInterval = useSettingsStore((s) => s.fetchIntervalSec)
  const setFetchInterval = useSettingsStore((s) => s.setFetchInterval)

  const themeOptions: { value: ThemePref; labelKey: string; icon: React.ReactNode }[] = [
    { value: 'auto', labelKey: 'settings.theme.auto', icon: <Laptop className="size-4" /> },
    { value: 'light', labelKey: 'settings.theme.light', icon: <Sun className="size-4" /> },
    { value: 'dark', labelKey: 'settings.theme.dark', icon: <Moon className="size-4" /> },
  ]
  const langOptions: { value: LangPref; labelKey: string; emoji: string }[] = [
    { value: 'auto', labelKey: 'settings.lang.auto', emoji: '🌐' },
    { value: 'en', labelKey: 'settings.lang.en', emoji: '🇺🇸' },
    { value: 'zh', labelKey: 'settings.lang.zh', emoji: '🇨🇳' },
    { value: 'ko', labelKey: 'settings.lang.ko', emoji: '🇰🇷' },
    { value: 'ja', labelKey: 'settings.lang.ja', emoji: '🇯🇵' },
  ]
  const intervalOptions: { value: number; labelKey: string }[] = [
    { value: 0, labelKey: 'settings.fetch.off' },
    { value: 30, labelKey: 'settings.fetch.30s' },
    { value: 60, labelKey: 'settings.fetch.1m' },
    { value: 300, labelKey: 'settings.fetch.5m' },
    { value: 900, labelKey: 'settings.fetch.15m' },
  ]

  const commit = __BUILD_INFO__.commit
  const buildInfo = commit ? `Goblin · v${__APP_VERSION__} · ${commit}` : `Goblin · v${__APP_VERSION__}`
  const saveThemePref = (pref: ThemePref) => {
    void setThemePref(pref).catch((err) => {
      console.warn('[settings] theme update failed', err)
    })
  }
  const saveLangPref = (pref: LangPref) => {
    void setLangPref(pref).catch((err) => {
      console.warn('[settings] language update failed', err)
    })
  }
  const saveFetchInterval = (sec: number) => {
    void setFetchInterval(sec).catch((err) => {
      console.warn('[settings] fetch interval update failed', err)
    })
  }
  const openProjectGitHub = () => {
    void rpc.app.openProjectGitHub.mutate().catch((err) => {
      console.warn('[settings] open project GitHub failed', err)
    })
  }

  return (
    <Modal open={open} title={t('settings.title')} onClose={onClose}>
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <Section label={t('settings.appearance')}>
            <SettingsSelect
              value={themePref}
              options={themeOptions.map((o) => ({ value: o.value, label: t(o.labelKey), icon: o.icon }))}
              onChange={saveThemePref}
            />
          </Section>

          <Section label={t('settings.lang')}>
            <SettingsSelect
              value={langPref}
              options={langOptions.map((o) => ({ value: o.value, label: `${o.emoji} ${t(o.labelKey)}` }))}
              onChange={saveLangPref}
            />
          </Section>

          <Section label={t('settings.fetch')} hint={t('settings.fetch-hint')} hintPlacement="bottom">
            <SettingsSelect
              value={fetchInterval}
              options={intervalOptions.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
              onChange={saveFetchInterval}
            />
          </Section>
        </div>

        <Section label={t('settings.shortcuts')} hint={t('settings.shortcuts-hint')}>
          <ShortcutSettings />
        </Section>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="truncate">{buildInfo}</span>
          <button
            type="button"
            data-interactive
            aria-label="Open project on GitHub"
            title="GitHub"
            className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-foreground"
            onClick={openProjectGitHub}
          >
            <GitHubMark className="size-4" />
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Section({
  label,
  hint,
  hintPlacement = 'top',
  children,
}: {
  label: string
  hint?: string
  hintPlacement?: 'top' | 'bottom'
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {hint && hintPlacement === 'top' && <div className="mb-2 text-xs text-muted-foreground">{hint}</div>}
      {children}
      {hint && hintPlacement === 'bottom' && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

interface SettingsSelectProps<T extends string | number> {
  value: T
  options: { value: T; label: string; icon?: React.ReactNode }[]
  onChange: (value: T) => void
}

function SettingsSelect<T extends string | number>({ value, options, onChange }: SettingsSelectProps<T>) {
  return (
    <Select
      value={String(value)}
      onValueChange={(v) => {
        const matched = options.find((o) => String(o.value) === v)
        if (matched) onChange(matched.value)
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={String(opt.value)} value={String(opt.value)}>
            {opt.icon}
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M12 0.75C5.79 0.75 0.75 5.79 0.75 12c0 4.97 3.22 9.19 7.69 10.68 0.56 0.1 0.77-0.24 0.77-0.54v-1.92c-3.13 0.68-3.79-1.34-3.79-1.34-0.51-1.3-1.25-1.65-1.25-1.65-1.02-0.7 0.08-0.68 0.08-0.68 1.13 0.08 1.73 1.16 1.73 1.16 1 1.72 2.63 1.22 3.27 0.93 0.1-0.72 0.39-1.22 0.71-1.5-2.5-0.28-5.13-1.25-5.13-5.56 0-1.23 0.44-2.23 1.16-3.02-0.12-0.28-0.5-1.43 0.11-2.98 0 0 0.95-0.3 3.1 1.15A10.8 10.8 0 0 1 12 6.35c0.96 0 1.91 0.13 2.81 0.38 2.15-1.45 3.1-1.15 3.1-1.15 0.61 1.55 0.23 2.7 0.11 2.98 0.72 0.79 1.16 1.79 1.16 3.02 0 4.32-2.63 5.27-5.14 5.55 0.4 0.35 0.76 1.04 0.76 2.1v3.11c0 0.3 0.2 0.65 0.77 0.54A11.26 11.26 0 0 0 23.25 12C23.25 5.79 18.21 0.75 12 0.75Z" />
    </svg>
  )
}
