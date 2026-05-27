// Unified settings overlay using Goblin's desktop UI tokens.

import { useRef, type ReactNode } from 'react'
import {
  AppWindow,
  Code2,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Hash,
  Info,
  Keyboard,
  Laptop,
  Moon,
  PackageCheck,
  Settings2,
  SlidersHorizontal,
  Sun,
  Tag,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '#/renderer/components/ui/dialog.tsx'
import { ScrollArea } from '#/renderer/components/ui/scroll-area.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/renderer/components/ui/select.tsx'
import { Switch } from '#/renderer/components/ui/switch.tsx'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { GitHubMark } from '#/renderer/components/GitHubMark.tsx'
import { ShortcutSettings } from '#/renderer/components/settings/ShortcutSettings.tsx'
import { useThemeStore } from '#/renderer/stores/theme.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import { useI18nStore, useT } from '#/renderer/stores/i18n.ts'
import {
  helpShortcutSections,
  type HelpShortcutRow,
  type HelpShortcutSection,
} from '#/renderer/keyboard/help-shortcuts.ts'
import { cn } from '#/renderer/lib/cn.ts'
import { COLOR_THEMES } from '#/shared/color-theme.ts'
import type { BadgeVariant } from '#/renderer/components/ui/badge.tsx'
import type { EditorPref, LangPref, TerminalPref, ThemePref } from '#/shared/rpc.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'
import { rpc } from '#/renderer/rpc.ts'

export type SettingsPage = 'general' | 'apps' | 'sync' | 'dependencies' | 'shortcuts' | 'about'

const appIconUrl = new URL('../../../assets/icon.png', import.meta.url).href

interface Props {
  open: boolean
  page: SettingsPage
  onPageChange: (page: SettingsPage) => void
  onClose: () => void
}

interface DependencyItem {
  Icon: LucideIcon
  badgeVariant: BadgeVariant
  badgeKey: string
  titleKey: string
  commandKey: string
  bodyKey: string
}

const CORE_DEPENDENCIES: DependencyItem[] = [
  {
    Icon: GitBranch,
    badgeVariant: 'warning',
    badgeKey: 'dependencies.required',
    titleKey: 'dependencies.git.title',
    commandKey: 'dependencies.git.command',
    bodyKey: 'dependencies.git.body',
  },
  {
    Icon: GitPullRequest,
    badgeVariant: 'brand',
    badgeKey: 'dependencies.optional',
    titleKey: 'dependencies.gh.title',
    commandKey: 'dependencies.gh.command',
    bodyKey: 'dependencies.gh.body',
  },
]

const TERMINAL_DEPENDENCIES: DependencyItem[] = [
  {
    Icon: Terminal,
    badgeVariant: 'brand',
    badgeKey: 'dependencies.optional',
    titleKey: 'dependencies.ghostty.title',
    commandKey: 'dependencies.ghostty.command',
    bodyKey: 'dependencies.ghostty.body',
  },
  {
    Icon: Terminal,
    badgeVariant: 'brand',
    badgeKey: 'dependencies.optional',
    titleKey: 'dependencies.terminal.title',
    commandKey: 'dependencies.terminal.command',
    bodyKey: 'dependencies.terminal.body',
  },
]

const EDITOR_DEPENDENCIES: DependencyItem[] = [
  {
    Icon: Code2,
    badgeVariant: 'brand',
    badgeKey: 'dependencies.optional',
    titleKey: 'dependencies.vscode.title',
    commandKey: 'dependencies.vscode.command',
    bodyKey: 'dependencies.vscode.body',
  },
  {
    Icon: Code2,
    badgeVariant: 'brand',
    badgeKey: 'dependencies.optional',
    titleKey: 'dependencies.cursor.title',
    commandKey: 'dependencies.cursor.command',
    bodyKey: 'dependencies.cursor.body',
  },
  {
    Icon: Code2,
    badgeVariant: 'brand',
    badgeKey: 'dependencies.optional',
    titleKey: 'dependencies.windsurf.title',
    commandKey: 'dependencies.windsurf.command',
    bodyKey: 'dependencies.windsurf.body',
  },
]

export function SettingsPanel({ open, page, onPageChange, onClose }: Props) {
  const t = useT()
  const selectedPageButtonRef = useRef<HTMLButtonElement | null>(null)
  const pages: { page: SettingsPage; label: string; title: string; Icon: LucideIcon }[] = [
    { page: 'general', label: t('settings.group.general'), title: t('settings.group.general'), Icon: Settings2 },
    { page: 'apps', label: t('settings.group.apps'), title: t('settings.group.apps'), Icon: AppWindow },
    { page: 'sync', label: t('settings.group.sync'), title: t('settings.group.sync'), Icon: SlidersHorizontal },
    {
      page: 'dependencies',
      label: t('settings.nav.dependencies'),
      title: t('dependencies.title'),
      Icon: PackageCheck,
    },
    { page: 'shortcuts', label: t('settings.nav.shortcuts'), title: t('settings.shortcuts'), Icon: Keyboard },
    { page: 'about', label: t('settings.about'), title: t('settings.about'), Icon: Info },
  ]
  const active = pages.find((item) => item.page === page) ?? pages[0]

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        showCloseButton
        className="h-[560px] max-h-[calc(100vh-2rem)] gap-0 overflow-hidden rounded-xl border bg-card p-0 shadow-lg sm:max-w-[760px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          selectedPageButtonRef.current?.focus()
        }}
      >
        <div className="flex h-full min-h-0 bg-background">
          <aside className="flex w-48 shrink-0 flex-col border-r border-separator bg-muted/30 px-3 py-3">
            <nav className="space-y-1" aria-label={t('settings.title')}>
              {pages.map((item) => (
                <button
                  key={item.page}
                  ref={page === item.page ? selectedPageButtonRef : undefined}
                  type="button"
                  data-interactive
                  onClick={() => onPageChange(item.page)}
                  className={cn(
                    'flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors duration-100',
                    page === item.page
                      ? 'bg-selected text-selected-foreground'
                      : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                  aria-current={page === item.page ? 'page' : undefined}
                >
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-md border',
                      page === item.page
                        ? 'border-brand-border bg-brand-surface text-brand-text'
                        : 'border-border bg-card text-muted-foreground',
                    )}
                  >
                    <item.Icon className="size-3.5" />
                  </span>
                  <span className="truncate font-medium">{item.label}</span>
                </button>
              ))}
            </nav>

            <div className="mt-auto" />
          </aside>

          <section className="flex min-w-0 flex-1 flex-col bg-card">
            <header className="flex h-14 shrink-0 items-center border-b border-separator px-5">
              <DialogTitle className="truncate text-sm font-semibold leading-tight text-foreground">
                {active.title}
              </DialogTitle>
            </header>
            <ScrollArea className="min-h-0 flex-1 bg-muted/20" viewportClassName="h-full">
              <div className="space-y-5 px-5 py-4">
                {page === 'general' && <GeneralSettings />}
                {page === 'apps' && <ExternalAppSettings />}
                {page === 'sync' && <SyncSettings />}
                {page === 'dependencies' && <DependenciesSettings />}
                {page === 'shortcuts' && <KeyboardShortcutSettings />}
                {page === 'about' && <AboutSettings />}
              </div>
            </ScrollArea>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function GeneralSettings() {
  const t = useT()
  const themePref = useThemeStore((s) => s.pref)
  const setThemePref = useThemeStore((s) => s.setPref)
  const colorTheme = useThemeStore((s) => s.colorTheme)
  const setColorTheme = useThemeStore((s) => s.setColorTheme)
  const toggleDetailOnActionBarBlankClick = useSettingsStore((s) => s.toggleDetailOnActionBarBlankClick)
  const setToggleDetailOnActionBarBlankClick = useSettingsStore((s) => s.setToggleDetailOnActionBarBlankClick)
  const langPref = useI18nStore((s) => s.pref)
  const setLangPref = useI18nStore((s) => s.setPref)
  const themeOptions: { value: ThemePref; labelKey: string; icon: ReactNode }[] = [
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
  const save = (fn: () => Promise<unknown>, label: string) => {
    void fn().catch((err) => console.warn(`[settings] ${label} update failed`, err))
  }

  return (
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
        <SettingsRow
          controlId="settings-action-bar-blank-toggle"
          label={t('settings.action-bar-blank-toggle')}
          hint={t('settings.action-bar-blank-toggle-hint')}
          control={
            <Switch
              id="settings-action-bar-blank-toggle"
              checked={toggleDetailOnActionBarBlankClick}
              onCheckedChange={(enabled) =>
                save(() => setToggleDetailOnActionBarBlankClick(enabled), 'action bar blank toggle')
              }
              aria-label={t('settings.action-bar-blank-toggle')}
            />
          }
        />
      </SettingsList>
    </SettingsGroup>
  )
}

function ExternalAppSettings() {
  const t = useT()
  const terminalApp = useSettingsStore((s) => s.terminalApp)
  const setTerminalApp = useSettingsStore((s) => s.setTerminalApp)
  const editorApp = useSettingsStore((s) => s.editorApp)
  const setEditorApp = useSettingsStore((s) => s.setEditorApp)
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
  const save = (fn: () => Promise<unknown>, label: string) => {
    void fn().catch((err) => console.warn(`[settings] ${label} update failed`, err))
  }

  return (
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
  )
}

function SyncSettings() {
  const t = useT()
  const fetchInterval = useSettingsStore((s) => s.fetchIntervalSec)
  const setFetchInterval = useSettingsStore((s) => s.setFetchInterval)
  const intervalOptions: { value: number; labelKey: string }[] = [
    { value: 0, labelKey: 'settings.fetch.off' },
    { value: 30, labelKey: 'settings.fetch.30s' },
    { value: 60, labelKey: 'settings.fetch.1m' },
    { value: 120, labelKey: 'settings.fetch.2m' },
    { value: 180, labelKey: 'settings.fetch.3m' },
    { value: 300, labelKey: 'settings.fetch.5m' },
    { value: 900, labelKey: 'settings.fetch.15m' },
  ]
  const save = (fn: () => Promise<unknown>, label: string) => {
    void fn().catch((err) => console.warn(`[settings] ${label} update failed`, err))
  }

  return (
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
  )
}

function AboutSettings() {
  const t = useT()
  const commit = __BUILD_INFO__.commit
  const openProjectGitHub = () => {
    void rpc.app.openProjectGitHub.mutate().catch((err) => {
      console.warn('[settings] open project GitHub failed', err)
    })
  }

  return (
    <ul className="overflow-hidden rounded-xl border border-border/60 bg-background/85 shadow-[var(--shadow-inset-highlight)]">
      <li className="flex min-h-14 items-center gap-3 px-4 py-2.5 [&+&]:border-t [&+&]:border-separator">
        <img src={appIconUrl} alt="Goblin" className="size-8 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium text-foreground">{t('about.app')}</span>
        </div>
      </li>
      <li className="flex min-h-14 items-center gap-3 px-4 py-2.5 [&+&]:border-t [&+&]:border-separator">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Tag size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium text-foreground">{t('about.version')}</span>
        </div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">v{__APP_VERSION__}</span>
      </li>
      <li className="flex min-h-14 items-center gap-3 px-4 py-2.5 [&+&]:border-t [&+&]:border-separator">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Hash size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium text-foreground">{t('about.build')}</span>
        </div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {commit || t('about.build.unknown')}
        </span>
      </li>
      <li className="flex min-h-14 items-center gap-3 px-4 py-2.5 [&+&]:border-t [&+&]:border-separator">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <GitHubMark className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium text-foreground">{t('about.github')}</span>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{t('about.github.body')}</p>
        </div>
        <button
          type="button"
          data-interactive
          onClick={openProjectGitHub}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
          aria-label={t('settings.open-github')}
        >
          <ExternalLink size={14} />
        </button>
      </li>
    </ul>
  )
}

function DependenciesSettings() {
  const t = useT()
  return (
    <>
      <p className="px-3 text-xs leading-snug text-muted-foreground">{t('dependencies.intro')}</p>
      <DependencyList items={CORE_DEPENDENCIES} />
      <SettingsGroup label={t('dependencies.group.terminals')} hint={t('dependencies.group.terminals-hint')}>
        <DependencyList items={TERMINAL_DEPENDENCIES} />
      </SettingsGroup>
      <SettingsGroup label={t('dependencies.group.editors')} hint={t('dependencies.group.editors-hint')}>
        <DependencyList items={EDITOR_DEPENDENCIES} />
      </SettingsGroup>
    </>
  )
}

function KeyboardShortcutSettings() {
  const t = useT()
  const globalShortcut = useSettingsStore((s) => s.globalShortcut)
  const swapCloseShortcuts = useSettingsStore((s) => s.swapCloseShortcuts)
  return (
    <>
      <SettingsGroup label={t('settings.shortcuts')}>
        <ShortcutSettings />
      </SettingsGroup>
      <SettingsGroup label={t('help.title')} hint={t('help.hint')}>
        <ShortcutList sections={helpShortcutSections(globalShortcut, swapCloseShortcuts)} />
      </SettingsGroup>
    </>
  )
}

function SettingsGroup({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="px-3 text-[11px] font-medium text-muted-foreground">{label}</legend>
      {hint && <div className="px-3 text-[11px] leading-snug text-muted-foreground/80">{hint}</div>}
      {children}
    </fieldset>
  )
}

function SettingsList({ children }: { children: ReactNode }) {
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
  control: ReactNode
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2.5 [&+&]:border-t [&+&]:border-separator">
      <div className="min-w-0 flex-1">
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
  options: { value: T; label: string; icon?: ReactNode }[]
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
      <SelectTrigger id={id} className="h-8 min-w-36 rounded-md bg-control px-2.5 text-xs shadow-none">
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

function DependencyList({ items }: { items: DependencyItem[] }) {
  return (
    <ul className="overflow-hidden rounded-xl border border-border/60 bg-background/85 shadow-[var(--shadow-inset-highlight)]">
      {items.map((item) => (
        <DependencyRow key={item.titleKey} item={item} />
      ))}
    </ul>
  )
}

function DependencyRow({ item }: { item: DependencyItem }) {
  const t = useT()
  const Icon = item.Icon
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2.5 [&+&]:border-t [&+&]:border-separator">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">{t(item.titleKey)}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{t(item.commandKey)}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{t(item.bodyKey)}</p>
      </div>
      <Badge variant={item.badgeVariant}>{t(item.badgeKey)}</Badge>
    </li>
  )
}

function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((k, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          {i > 0 && <span className="text-[10px] text-muted-foreground/60">+</span>}
          <span className="kbd">{k}</span>
        </span>
      ))}
    </span>
  )
}

function KeyCombos({ combos }: { combos: string[][] }) {
  return (
    <span className="flex shrink-0 flex-wrap justify-end gap-x-1 gap-y-0.5">
      {combos.map((combo, i) => (
        <span key={`${combo.join('+')}:${i}`} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-[11px] text-muted-foreground/60">/</span>}
          <KeyCombo keys={combo} />
        </span>
      ))}
    </span>
  )
}

function ShortcutList({ sections }: { sections: HelpShortcutSection[] }) {
  const t = useT()
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-background/85 shadow-[var(--shadow-inset-highlight)]">
      {sections.map((section) => (
        <section key={section.titleKey} className="[&+&]:border-t [&+&]:border-separator">
          <div className="flex h-8 items-center bg-muted/35 px-3 text-[11px] font-medium text-muted-foreground">
            {t(section.titleKey)}
          </div>
          <ul>
            {section.rows.map((row) => (
              <ShortcutRow key={`${row.labelKey}:${row.combos.map((combo) => combo.join('+')).join('/')}`} row={row} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ShortcutRow({ row }: { row: HelpShortcutRow }) {
  const t = useT()
  return (
    <li className="flex min-h-9 items-center justify-between gap-3 border-t border-separator px-3 py-1.5">
      <span className="min-w-0 pr-2 text-[13px] leading-snug text-foreground">{t(row.labelKey)}</span>
      <KeyCombos combos={row.combos} />
    </li>
  )
}
