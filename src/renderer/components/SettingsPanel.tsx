// Settings overlay — theme pref, language, auto-fetch interval.
// Mounted unconditionally and gated by `open`; the modal itself
// returns null when closed.

import { Modal } from '#/renderer/components/Modal.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/renderer/components/ui/toggle-group.tsx'
import { useThemeStore } from '#/renderer/stores/theme.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import { useI18nStore, useT } from '#/renderer/stores/i18n.ts'
import type { LangPref, ThemePref } from '#/renderer/types-bridge.ts'

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

  const themeOptions: { value: ThemePref; labelKey: string }[] = [
    { value: 'auto', labelKey: 'settings.theme.auto' },
    { value: 'light', labelKey: 'settings.theme.light' },
    { value: 'dark', labelKey: 'settings.theme.dark' },
  ]
  const langOptions: { value: LangPref; labelKey: string }[] = [
    { value: 'auto', labelKey: 'settings.lang.auto' },
    { value: 'en', labelKey: 'settings.lang.en' },
    { value: 'zh', labelKey: 'settings.lang.zh' },
    { value: 'ko', labelKey: 'settings.lang.ko' },
    { value: 'ja', labelKey: 'settings.lang.ja' },
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

  return (
    <Modal open={open} title={t('settings.title')} onClose={onClose} widthClass="max-w-lg">
      <div className="space-y-6">
        <Section label={t('settings.appearance')}>
          <SegmentedControl
            value={themePref}
            options={themeOptions.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            onChange={(v) => void setThemePref(v)}
          />
        </Section>

        <Section label={t('settings.lang')}>
          <SegmentedControl
            value={langPref}
            options={langOptions.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            onChange={(v) => void setLangPref(v)}
          />
        </Section>

        <Section label={t('settings.fetch')} hint={t('settings.fetchHint')}>
          <SegmentedControl
            value={fetchInterval}
            options={intervalOptions.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            onChange={(v) => void setFetchInterval(v)}
          />
        </Section>

        <div className="border-t border-border pt-3 text-xs text-muted-foreground/60">{buildInfo}</div>
      </div>
    </Modal>
  )
}

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {hint && <div className="mb-2 text-xs text-muted-foreground">{hint}</div>}
      {children}
    </div>
  )
}

interface SegmentedProps<T extends string | number> {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}

function SegmentedControl<T extends string | number>({ value, options, onChange }: SegmentedProps<T>) {
  // ToggleGroup is a Radix primitive: single-select gives us
  // arrow-key navigation, aria-pressed, and proper roving-tabindex
  // for free. We render it as `outline` + `spacing=0` so the items
  // sit flush in a bordered pill — same visual idiom as the previous
  // hand-rolled SegmentedControl, but with Radix wiring under it.
  return (
    <ToggleGroup
      type="single"
      value={String(value)}
      onValueChange={(v) => {
        if (!v) return
        // ToggleGroup gives back a string; cast it to whichever shape
        // the caller specified (string | number) by matching against
        // the original options.
        const matched = options.find((o) => String(o.value) === v)
        if (matched) onChange(matched.value)
      }}
      variant="outline"
      size="sm"
    >
      {options.map((opt) => (
        <ToggleGroupItem key={String(opt.value)} value={String(opt.value)}>
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
