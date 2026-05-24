// Settings overlay — grouped by function: general look & feel, external
// apps (terminal / editor), sync, and keyboard shortcuts.

import { Laptop, Moon, Sun } from 'lucide-react'
import { Modal } from '#/renderer/components/Modal.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/renderer/components/ui/select.tsx'
import { GitHubMark } from '#/renderer/components/GitHubMark.tsx'
import { ShortcutSettings } from '#/renderer/components/settings/ShortcutSettings.tsx'
import { useThemeStore } from '#/renderer/stores/theme.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import { useI18nStore, useT } from '#/renderer/stores/i18n.ts'
import { COLOR_THEMES } from '#/shared/color-theme.ts'
import type { EditorPref, LangPref, TerminalPref, ThemePref } from '#/shared/rpc.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'
import { rpc } from '#/renderer/rpc.ts'

interface Props {
  open: boolean
  onClose: () => void
}

export function SettingsPanel({ open, onClose }: Props) {
  const t = useT()
  const themePref = useThemeStore((s) => s.pref)
  const setThemePref = useThemeStore((s) => s.setPref)
  const colorTheme = useThemeStore((s) => s.colorTheme)
  const setColorTheme = useThemeStore((s) => s.setColorTheme)
  const langPref = useI18nStore((s) => s.pref)
  const setLangPref = useI18nStore((s) => s.setPref)
  const fetchInterval = useSettingsStore((s) => s.fetchIntervalSec)
  const setFetchInterval = useSettingsStore((s) => s.setFetchInterval)
  const terminalApp = useSettingsStore((s) => s.terminalApp)
  const setTerminalApp = useSettingsStore((s) => s.setTerminalApp)
  const editorApp = useSettingsStore((s) => s.editorApp)
  const setEditorApp = useSettingsStore((s) => s.setEditorApp)

  const themeOptions: { value: ThemePref; labelKey: string; icon: React.ReactNode }[] = [
    { value: 'auto', labelKey: 'settings.theme.auto', icon: <Laptop className="size-4" /> },
    { value: 'light', labelKey: 'settings.theme.light', icon: <Sun className="size-4" /> },
    { value: 'dark', labelKey: 'settings.theme.dark', icon: <Moon className="size-4" /> },
  ]
  const colorThemeOptions: { value: ColorTheme; labelKey: string }[] = COLOR_THEMES.map((value) => ({
    value,
    labelKey: `settings.color-theme.${value}`,
  }))
  const langOptions: { value: LangPref; labelKey: string; emoji: string }[] = [
    { value: 'auto', labelKey: 'settings.lang.auto', emoji: '🌐' },
    { value: 'en', labelKey: 'settings.lang.en', emoji: '🇺🇸' },
    { value: 'zh', labelKey: 'settings.lang.zh', emoji: '🇨🇳' },
    { value: 'ko', labelKey: 'settings.lang.ko', emoji: '🇰🇷' },
    { value: 'ja', labelKey: 'settings.lang.ja', emoji: '🇯🇵' },
  ]
  const terminalOptions: { value: TerminalPref; labelKey: string }[] = [
    { value: 'auto', labelKey: 'settings.terminal.auto' },
    { value: 'ghostty', labelKey: 'settings.terminal.ghostty' },
    { value: 'terminal', labelKey: 'settings.terminal.terminal' },
  ]
  const editorOptions: { value: EditorPref; labelKey: string }[] = [
    { value: 'auto', labelKey: 'settings.editor.auto' },
    { value: 'vscode', labelKey: 'settings.editor.vscode' },
    { value: 'cursor', labelKey: 'settings.editor.cursor' },
    { value: 'windsurf', labelKey: 'settings.editor.windsurf' },
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
  const save = (fn: () => Promise<unknown>, label: string) => {
    void fn().catch((err) => console.warn(`[settings] ${label} update failed`, err))
  }
  const openProjectGitHub = () => {
    void rpc.app.openProjectGitHub.mutate().catch((err) => {
      console.warn('[settings] open project GitHub failed', err)
    })
  }

  return (
    <Modal open={open} title={t('settings.title')} onClose={onClose} widthClass="sm:max-w-lg">
      <div className="-m-4 space-y-5 bg-muted/30 px-5 py-4">
        {/* ---- General ---- */}
        <SettingsGroup label={t('settings.group.general')}>
          <SettingsList>
            <SettingsRow
              controlId="settings-color-theme"
              label={t('settings.color-theme')}
              control={
                <SettingsSelect
                  id="settings-color-theme"
                  value={colorTheme}
                  options={colorThemeOptions.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                  onChange={(v) => save(() => setColorTheme(v), 'color theme')}
                />
              }
            />
            <SettingsRow
              controlId="settings-theme"
              label={t('settings.appearance')}
              control={
                <SettingsSelect
                  id="settings-theme"
                  value={themePref}
                  options={themeOptions.map((o) => ({ value: o.value, label: t(o.labelKey), icon: o.icon }))}
                  onChange={(v) => save(() => setThemePref(v), 'theme')}
                />
              }
            />
            <SettingsRow
              controlId="settings-language"
              label={t('settings.lang')}
              control={
                <SettingsSelect
                  id="settings-language"
                  value={langPref}
                  options={langOptions.map((o) => ({ value: o.value, label: `${o.emoji} ${t(o.labelKey)}` }))}
                  onChange={(v) => save(() => setLangPref(v), 'language')}
                />
              }
            />
          </SettingsList>
        </SettingsGroup>

        {/* ---- External apps ---- */}
        <SettingsGroup label={t('settings.group.apps')}>
          <SettingsList>
            <SettingsRow
              controlId="settings-terminal"
              label={t('settings.terminal')}
              control={
                <SettingsSelect
                  id="settings-terminal"
                  value={terminalApp}
                  options={terminalOptions.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                  onChange={(v) => save(() => setTerminalApp(v), 'terminal')}
                />
              }
            />
            <SettingsRow
              controlId="settings-editor"
              label={t('settings.editor')}
              control={
                <SettingsSelect
                  id="settings-editor"
                  value={editorApp}
                  options={editorOptions.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                  onChange={(v) => save(() => setEditorApp(v), 'editor')}
                />
              }
            />
          </SettingsList>
        </SettingsGroup>

        {/* ---- Sync ---- */}
        <SettingsGroup label={t('settings.group.sync')}>
          <SettingsList>
            <SettingsRow
              controlId="settings-fetch"
              label={t('settings.fetch')}
              hint={t('settings.fetch-hint')}
              control={
                <SettingsSelect
                  id="settings-fetch"
                  value={fetchInterval}
                  options={intervalOptions.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                  onChange={(v) => save(() => setFetchInterval(v), 'fetch interval')}
                />
              }
            />
          </SettingsList>
        </SettingsGroup>

        {/* ---- Shortcuts ---- */}
        <SettingsGroup label={t('settings.shortcuts')}>
          <ShortcutSettings />
        </SettingsGroup>

        {/* ---- Footer ---- */}
        <div className="flex min-h-8 items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="truncate">{buildInfo}</span>
          <button
            type="button"
            data-interactive
            aria-label={t('settings.open-github')}
            title={t('settings.open-github')}
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

function SettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="px-3 text-[11px] font-medium text-muted-foreground">{label}</legend>
      {children}
    </fieldset>
  )
}

function SettingsList({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-background/85 shadow-[var(--shadow-inset-highlight)]">
      {children}
    </div>
  )
}

function SettingsRow({
  controlId,
  label,
  hint,
  control,
}: {
  controlId: string
  label: string
  hint?: string
  control: React.ReactNode
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 px-3 py-2 [&+&]:border-t [&+&]:border-separator">
      <div className="min-w-0">
        <label className="block truncate text-sm text-foreground" htmlFor={controlId}>
          {label}
        </label>
        {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

interface SettingsSelectProps<T extends string | number> {
  id: string
  value: T
  options: { value: T; label: string; icon?: React.ReactNode }[]
  onChange: (value: T) => void
}

function SettingsSelect<T extends string | number>({ id, value, options, onChange }: SettingsSelectProps<T>) {
  return (
    <Select
      value={String(value)}
      onValueChange={(v) => {
        const matched = options.find((o) => String(o.value) === v)
        if (matched) onChange(matched.value)
      }}
    >
      <SelectTrigger id={id} className="h-8 min-w-36 rounded-md bg-muted/50 px-2.5 text-xs shadow-none">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={String(opt.value)} value={String(opt.value)} textValue={opt.label}>
            {opt.icon}
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
