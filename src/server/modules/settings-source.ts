import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { toSafeRepoLocator, toSafeSessionRepoEntry } from '#/shared/input-validation.ts'
import { serverDataFile } from '#/shared/data-dir.ts'
import type { EditorPref, LangPref, SessionState, SettingsPrefs, TerminalPref, ThemePref } from '#/shared/api-types.ts'
import { DEFAULT_WORKSPACE_FOCUSED, normalizeWorkspacePaneSizes } from '#/shared/workspace-layout.ts'
import { repoSessionEntryId, type RepoSessionEntry } from '#/shared/remote-repo.ts'
import { isWorkspacePaneViewType, type WorkspacePaneView } from '#/shared/workspace-pane.ts'
import { normalizeGlobalShortcut } from '#/shared/accelerator.ts'
import { isColorTheme, type ColorTheme } from '#/shared/color-theme.ts'
import {
  DEFAULT_COLOR_THEME,
  DEFAULT_EDITOR_APP,
  DEFAULT_FETCH_INTERVAL_SEC,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_GLOBAL_SHORTCUT_DISABLED,
  DEFAULT_LANG_PREF,
  DEFAULT_SHORTCUTS_DISABLED,
  DEFAULT_SWAP_CLOSE_SHORTCUTS,
  DEFAULT_TERMINAL_APP,
  DEFAULT_TERMINAL_NOTIFICATIONS_ENABLED,
  DEFAULT_THEME_PREF,
  MAX_RECENT_REPOS,
  defaultSessionState,
  defaultSettingsPrefs,
} from '#/shared/settings-defaults.ts'

type FetchIntervalListener = (sec: number) => void
interface ServerSettingsData {
  lang: LangPref
  theme: ThemePref
  colorTheme: ColorTheme
  fetchIntervalSec: number
  terminalNotificationsEnabled: boolean
  shortcutsDisabled: boolean
  globalShortcutDisabled: boolean
  swapCloseShortcuts: boolean
  globalShortcut: string
  terminalApp: TerminalPref
  editorApp: EditorPref
  lanEnabled: boolean
  session: SessionState
  recentRepos: RepoSessionEntry[]
}

export type ServerSettingsPrefsPatch = Partial<SettingsPrefs>

let cachedFetchIntervalSec = DEFAULT_FETCH_INTERVAL_SEC
let settingsPromise: Promise<ServerSettingsData> | null = null
const listeners = new Set<FetchIntervalListener>()

function normalizeFetchInterval(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(3600, Math.round(value)))
    : DEFAULT_FETCH_INTERVAL_SEC
}

function normalizeThemePref(value: unknown): ThemePref {
  return value === 'auto' || value === 'light' || value === 'dark' ? value : DEFAULT_THEME_PREF
}

function normalizeLangPref(value: unknown): LangPref {
  return value === 'auto' || value === 'en' || value === 'zh' || value === 'ko' || value === 'ja'
    ? value
    : DEFAULT_LANG_PREF
}

function normalizeColorTheme(value: unknown): ColorTheme {
  return isColorTheme(value) ? value : DEFAULT_COLOR_THEME
}

function normalizeTerminalPref(value: unknown): TerminalPref {
  // `windowsTerminal` is a win32-only option. If a synced settings.json
  // hands us this value on macOS or Linux, fall back to the default rather
  // than persisting an unreachable preference. (On win32 we accept it
  // so the user can explicitly pick Windows Terminal.)
  if (value === 'auto' || value === 'ghostty' || value === 'terminal') return value
  if (value === 'windowsTerminal') return process.platform === 'win32' ? value : DEFAULT_TERMINAL_APP
  return DEFAULT_TERMINAL_APP
}

function normalizeEditorPref(value: unknown): EditorPref {
  return value === 'auto' || value === 'vscode' || value === 'cursor' || value === 'windsurf'
    ? value
    : DEFAULT_EDITOR_APP
}

function normalizeTerminalNotificationsEnabled(value: unknown): boolean {
  return value === true
}

function normalizeLanEnabled(value: unknown): boolean {
  return value === true
}

function settingsPrefsFromData(data: ServerSettingsData): SettingsPrefs {
  return {
    lang: data.lang,
    theme: data.theme,
    colorTheme: data.colorTheme,
    fetchIntervalSec: data.fetchIntervalSec,
    terminalNotificationsEnabled: data.terminalNotificationsEnabled,
    shortcutsDisabled: data.shortcutsDisabled,
    globalShortcutDisabled: data.globalShortcutDisabled,
    swapCloseShortcuts: data.swapCloseShortcuts,
    globalShortcut: data.globalShortcut,
    terminalApp: data.terminalApp,
    editorApp: data.editorApp,
    lanEnabled: data.lanEnabled,
  }
}

function dedupeRepoEntries(entries: RepoSessionEntry[]): RepoSessionEntry[] {
  const seen = new Set<string>()
  const normalized: RepoSessionEntry[] = []
  for (const entry of entries) {
    const id = repoSessionEntryId(entry)
    if (seen.has(id)) continue
    seen.add(id)
    normalized.push(entry)
  }
  return normalized
}

function defaultSession(): SessionState {
  return defaultSessionState()
}

function normalizeSelectedTerminalByWorktree(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const normalized: Record<string, string> = {}
  for (const [worktreeKey, key] of Object.entries(value)) {
    if (typeof worktreeKey !== 'string' || typeof key !== 'string') continue
    const parts = worktreeKey.split('\0')
    if (parts.length !== 2 || !parts[0] || !parts[1]) continue
    if (!key.startsWith(`${worktreeKey}\0`)) continue
    normalized[worktreeKey] = key
  }
  return normalized
}

function normalizeWorkspacePaneViewByBranchByRepo(
  value: unknown,
  openRepos: RepoSessionEntry[],
): Record<string, Record<string, WorkspacePaneView>> {
  if (!value || typeof value !== 'object') return {}
  const openRepoIds = new Set(openRepos.map(repoSessionEntryId))
  const normalized: Record<string, Record<string, WorkspacePaneView>> = {}
  for (const [repoId, rawByBranch] of Object.entries(value)) {
    const safeRepoId = toSafeRepoLocator(repoId)
    if (!safeRepoId || !openRepoIds.has(safeRepoId) || !rawByBranch || typeof rawByBranch !== 'object') continue
    const byBranch: Record<string, WorkspacePaneView> = {}
    for (const [branchName, paneView] of Object.entries(rawByBranch)) {
      if (!branchName || branchName.includes('\0')) continue
      if (typeof paneView === 'string' && isWorkspacePaneViewType(paneView)) byBranch[branchName] = paneView
    }
    if (Object.keys(byBranch).length > 0) normalized[safeRepoId] = byBranch
  }
  return normalized
}

function normalizeSession(value: unknown): SessionState {
  if (!value || typeof value !== 'object') return defaultSession()
  const partial = value as Partial<SessionState>
  const openRepos = Array.isArray(partial.openRepos)
    ? dedupeRepoEntries(
        partial.openRepos.map(toSafeSessionRepoEntry).filter((entry): entry is RepoSessionEntry => entry !== null),
      )
    : []
  const activeRepo = toSafeRepoLocator(partial.activeRepo)
  return {
    openRepos,
    activeRepo: activeRepo && openRepos.some((entry) => repoSessionEntryId(entry) === activeRepo) ? activeRepo : null,
    workspaceFocused:
      typeof partial.workspaceFocused === 'boolean' ? partial.workspaceFocused : DEFAULT_WORKSPACE_FOCUSED,
    workspacePaneSizes: normalizeWorkspacePaneSizes(partial.workspacePaneSizes),
    selectedTerminalByWorktree: normalizeSelectedTerminalByWorktree(partial.selectedTerminalByWorktree),
    workspacePaneViewByBranchByRepo: normalizeWorkspacePaneViewByBranchByRepo(
      partial.workspacePaneViewByBranchByRepo,
      openRepos,
    ),
  }
}

function normalizeRecentRepos(value: unknown): RepoSessionEntry[] {
  if (!Array.isArray(value)) return []
  return dedupeRepoEntries(
    value.map(toSafeSessionRepoEntry).filter((entry): entry is RepoSessionEntry => entry !== null),
  ).slice(0, MAX_RECENT_REPOS)
}

async function readServerSettingsFile(): Promise<ServerSettingsData | null> {
  try {
    const raw = await readFile(serverDataFile('server-settings.json'), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<ServerSettingsData>
    return {
      lang: normalizeLangPref(parsed.lang),
      theme: normalizeThemePref(parsed.theme),
      colorTheme: normalizeColorTheme(parsed.colorTheme),
      fetchIntervalSec: normalizeFetchInterval(parsed.fetchIntervalSec),
      terminalNotificationsEnabled: normalizeTerminalNotificationsEnabled(parsed.terminalNotificationsEnabled),
      shortcutsDisabled: parsed.shortcutsDisabled === true,
      globalShortcutDisabled: parsed.globalShortcutDisabled === true,
      swapCloseShortcuts: parsed.swapCloseShortcuts === true,
      globalShortcut: normalizeGlobalShortcut(parsed.globalShortcut),
      terminalApp: normalizeTerminalPref(parsed.terminalApp),
      editorApp: normalizeEditorPref(parsed.editorApp),
      lanEnabled: normalizeLanEnabled(parsed.lanEnabled),
      session: normalizeSession(parsed.session),
      recentRepos: normalizeRecentRepos(parsed.recentRepos),
    }
  } catch {
    return null
  }
}

async function writeServerSettingsFile(data: ServerSettingsData): Promise<void> {
  const file = serverDataFile('server-settings.json')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(data, null, 2), 'utf-8')
}

async function loadServerSettings(): Promise<ServerSettingsData> {
  settingsPromise ??= (async () => {
    const persisted = await readServerSettingsFile()
    const data = persisted ?? { ...defaultSettingsPrefs(), session: defaultSession(), recentRepos: [] }
    await writeServerSettingsFile(data)
    cachedFetchIntervalSec = data.fetchIntervalSec
    return data
  })()
  return await settingsPromise
}

export async function getServerFetchIntervalSec(): Promise<number> {
  await loadServerSettings()
  return cachedFetchIntervalSec
}

export async function getServerSettingsPrefs(): Promise<SettingsPrefs> {
  return settingsPrefsFromData(await loadServerSettings())
}

export function subscribeServerFetchInterval(listener: FetchIntervalListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function setServerFetchIntervalSec(sec: number): Promise<number> {
  const data = await loadServerSettings()
  const next = normalizeFetchInterval(sec)
  if (data.fetchIntervalSec !== next) {
    data.fetchIntervalSec = next
    await writeServerSettingsFile(data)
  }
  if (cachedFetchIntervalSec !== next) {
    cachedFetchIntervalSec = next
    for (const listener of listeners) listener(next)
  }
  return next
}

export async function updateServerSettingsPrefs(patch: ServerSettingsPrefsPatch): Promise<SettingsPrefs> {
  const data = await loadServerSettings()
  const nextLang = patch.lang === undefined ? data.lang : normalizeLangPref(patch.lang)
  const nextTheme = patch.theme === undefined ? data.theme : normalizeThemePref(patch.theme)
  const nextColorTheme = patch.colorTheme === undefined ? data.colorTheme : normalizeColorTheme(patch.colorTheme)
  const nextFetchIntervalSec =
    patch.fetchIntervalSec === undefined ? data.fetchIntervalSec : normalizeFetchInterval(patch.fetchIntervalSec)
  const nextTerminalNotificationsEnabled =
    patch.terminalNotificationsEnabled === undefined
      ? data.terminalNotificationsEnabled
      : normalizeTerminalNotificationsEnabled(patch.terminalNotificationsEnabled)
  const nextShortcutsDisabled =
    patch.shortcutsDisabled === undefined ? data.shortcutsDisabled : patch.shortcutsDisabled === true
  const nextGlobalShortcutDisabled =
    patch.globalShortcutDisabled === undefined ? data.globalShortcutDisabled : patch.globalShortcutDisabled === true
  const nextSwapCloseShortcuts =
    patch.swapCloseShortcuts === undefined ? data.swapCloseShortcuts : patch.swapCloseShortcuts === true
  const nextGlobalShortcut =
    patch.globalShortcut === undefined ? data.globalShortcut : normalizeGlobalShortcut(patch.globalShortcut)
  const nextTerminalApp = patch.terminalApp === undefined ? data.terminalApp : normalizeTerminalPref(patch.terminalApp)
  const nextEditorApp = patch.editorApp === undefined ? data.editorApp : normalizeEditorPref(patch.editorApp)
  const nextLanEnabled = patch.lanEnabled === undefined ? data.lanEnabled : normalizeLanEnabled(patch.lanEnabled)
  const changed =
    data.lang !== nextLang ||
    data.theme !== nextTheme ||
    data.colorTheme !== nextColorTheme ||
    data.fetchIntervalSec !== nextFetchIntervalSec ||
    data.terminalNotificationsEnabled !== nextTerminalNotificationsEnabled ||
    data.shortcutsDisabled !== nextShortcutsDisabled ||
    data.globalShortcutDisabled !== nextGlobalShortcutDisabled ||
    data.swapCloseShortcuts !== nextSwapCloseShortcuts ||
    data.globalShortcut !== nextGlobalShortcut ||
    data.terminalApp !== nextTerminalApp ||
    data.editorApp !== nextEditorApp ||
    data.lanEnabled !== nextLanEnabled
  data.lang = nextLang
  data.theme = nextTheme
  data.colorTheme = nextColorTheme
  data.fetchIntervalSec = nextFetchIntervalSec
  data.terminalNotificationsEnabled = nextTerminalNotificationsEnabled
  data.shortcutsDisabled = nextShortcutsDisabled
  data.globalShortcutDisabled = nextGlobalShortcutDisabled
  data.swapCloseShortcuts = nextSwapCloseShortcuts
  data.globalShortcut = nextGlobalShortcut
  data.terminalApp = nextTerminalApp
  data.editorApp = nextEditorApp
  data.lanEnabled = nextLanEnabled
  if (changed) await writeServerSettingsFile(data)
  if (cachedFetchIntervalSec !== nextFetchIntervalSec) {
    cachedFetchIntervalSec = nextFetchIntervalSec
    for (const listener of listeners) listener(nextFetchIntervalSec)
  }
  return settingsPrefsFromData(data)
}

export async function getServerSessionState(): Promise<SessionState> {
  return (await loadServerSettings()).session
}

export async function setServerSessionState(session: SessionState): Promise<SessionState> {
  const data = await loadServerSettings()
  const next = normalizeSession(session)
  data.session = next
  await writeServerSettingsFile(data)
  return next
}

export async function getServerRecentRepos(): Promise<RepoSessionEntry[]> {
  return [...(await loadServerSettings()).recentRepos]
}

export async function addServerRecentRepo(repo: RepoSessionEntry): Promise<RepoSessionEntry[]> {
  const data = await loadServerSettings()
  const safeRepo = toSafeSessionRepoEntry(repo)
  if (!safeRepo) return [...data.recentRepos]
  const safeId = repoSessionEntryId(safeRepo)
  data.recentRepos = [safeRepo, ...data.recentRepos.filter((entry) => repoSessionEntryId(entry) !== safeId)].slice(
    0,
    MAX_RECENT_REPOS,
  )
  await writeServerSettingsFile(data)
  return [...data.recentRepos]
}

export async function clearServerRecentRepos(): Promise<void> {
  const data = await loadServerSettings()
  if (data.recentRepos.length === 0) return
  data.recentRepos = []
  await writeServerSettingsFile(data)
}

export function resetServerSettingsSourceForTests(): void {
  settingsPromise = null
  listeners.clear()
  cachedFetchIntervalSec = DEFAULT_FETCH_INTERVAL_SEC
}
