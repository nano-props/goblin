import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { toSafeRepoLocator, toSafeSessionRepoEntry } from '#/shared/input-validation.ts'
import { serverDataFile } from '#/shared/data-dir.ts'
import type { LangPref, WorkspaceSessionState, UserSettings, ThemePref } from '#/shared/api-types.ts'
import { DEFAULT_ZEN_MODE, normalizeWorkspacePaneSize } from '#/shared/workspace-layout.ts'
import { repoSessionEntryId, type RepoSessionEntry } from '#/shared/remote-repo.ts'
import {
  isWorktreeBootstrapConfigHash,
  type RepoSettingsEntry,
  type WorktreeBootstrapTrust,
} from '#/shared/repo-settings.ts'
import {
  isWorkspacePaneSessionTabType,
  isWorkspacePaneStaticTabType,
  isWorkspacePaneTabOrderEntry,
  type WorkspacePaneSessionTabType,
  type WorkspacePaneStaticTabType,
  type WorkspacePaneTabOrderEntry,
  workspacePaneStaticTabOrderEntry,
} from '#/shared/workspace-pane.ts'
import { normalizeGlobalShortcut } from '#/shared/accelerator.ts'
import { isColorTheme, type ColorTheme } from '#/shared/color-theme.ts'
import {
  DEFAULT_COLOR_THEME,
  DEFAULT_FETCH_INTERVAL_SEC,
  DEFAULT_GLOBAL_SHORTCUT,
  DEFAULT_GLOBAL_SHORTCUT_DISABLED,
  DEFAULT_LANG_PREF,
  DEFAULT_SHORTCUTS_DISABLED,
  DEFAULT_TERMINAL_NOTIFICATIONS_ENABLED,
  DEFAULT_THEME_PREF,
  MAX_RECENT_REPOS,
  defaultSessionState,
  defaultUserSettings,
} from '#/shared/settings-defaults.ts'

type FetchIntervalListener = (sec: number) => void
interface UserSettingsData {
  lang: LangPref
  theme: ThemePref
  colorTheme: ColorTheme
  fetchIntervalSec: number
  terminalNotificationsEnabled: boolean
  shortcutsDisabled: boolean
  globalShortcutDisabled: boolean
  globalShortcut: string
  lanEnabled: boolean
  session: WorkspaceSessionState
  recentRepos: RepoSessionEntry[]
  repoSettings: RepoSettingsEntry[]
}

export type UserSettingsPatch = Partial<UserSettings>

let cachedFetchIntervalSec = DEFAULT_FETCH_INTERVAL_SEC
let settingsPromise: Promise<UserSettingsData> | null = null
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

function normalizeTerminalNotificationsEnabled(value: unknown): boolean {
  return value === true
}

function normalizeLanEnabled(value: unknown): boolean {
  return value === true
}

function userSettingsFromData(data: UserSettingsData): UserSettings {
  return {
    lang: data.lang,
    theme: data.theme,
    colorTheme: data.colorTheme,
    fetchIntervalSec: data.fetchIntervalSec,
    terminalNotificationsEnabled: data.terminalNotificationsEnabled,
    shortcutsDisabled: data.shortcutsDisabled,
    globalShortcutDisabled: data.globalShortcutDisabled,
    globalShortcut: data.globalShortcut,
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

function defaultSession(): WorkspaceSessionState {
  return defaultSessionState()
}

function normalizeSelectedTerminalSessionByWorktree(value: unknown): Record<string, string> {
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

function normalizePreferredWorkspacePaneTabByBranchByRepo(
  value: unknown,
  openRepoEntries: RepoSessionEntry[],
  tabOrderByRepo: Record<string, Record<string, WorkspacePaneTabOrderEntry[]>>,
): Record<string, Record<string, WorkspacePaneSessionTabType>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const openRepoIds = new Set(openRepoEntries.map(repoSessionEntryId))
  const normalized: Record<string, Record<string, WorkspacePaneSessionTabType>> = {}
  for (const [repoId, rawByBranch] of Object.entries(value)) {
    const safeRepoId = toSafeRepoLocator(repoId)
    if (
      !safeRepoId ||
      !openRepoIds.has(safeRepoId) ||
      !rawByBranch ||
      typeof rawByBranch !== 'object' ||
      Array.isArray(rawByBranch)
    )
      continue
    const byBranch: Record<string, WorkspacePaneSessionTabType> = {}
    for (const [branchName, paneView] of Object.entries(rawByBranch)) {
      if (!branchName || branchName.includes('\0')) continue
      if (typeof paneView !== 'string' || !isWorkspacePaneSessionTabType(paneView)) continue
      if (
        isWorkspacePaneStaticTabType(paneView) &&
        !workspacePaneStaticViews(tabOrderByRepo[safeRepoId]?.[branchName] ?? []).includes(paneView)
      )
        continue
      byBranch[branchName] = paneView
    }
    if (Object.keys(byBranch).length > 0) normalized[safeRepoId] = byBranch
  }
  return normalized
}

function normalizeWorkspacePaneTabOrderByBranchByRepo(
  value: unknown,
  openRepoEntries: RepoSessionEntry[],
): Record<string, Record<string, WorkspacePaneTabOrderEntry[]>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const openRepoIds = new Set(openRepoEntries.map(repoSessionEntryId))
  const normalized: Record<string, Record<string, WorkspacePaneTabOrderEntry[]>> = {}
  for (const [repoId, rawByBranch] of Object.entries(value)) {
    const safeRepoId = toSafeRepoLocator(repoId)
    if (
      !safeRepoId ||
      !openRepoIds.has(safeRepoId) ||
      !rawByBranch ||
      typeof rawByBranch !== 'object' ||
      Array.isArray(rawByBranch)
    )
      continue
    const byBranch: Record<string, WorkspacePaneTabOrderEntry[]> = {}
    for (const [branchName, rawOrder] of Object.entries(rawByBranch)) {
      if (!branchName || branchName.includes('\0') || !Array.isArray(rawOrder)) continue
      const order: WorkspacePaneTabOrderEntry[] = []
      const seen = new Set<string>()
      for (const raw of rawOrder) {
        if (!isWorkspacePaneTabOrderEntry(raw)) continue
        const entry =
          raw.type === 'terminal'
            ? { type: 'terminal' as const, id: raw.id }
            : workspacePaneStaticTabOrderEntry(raw.type)
        const identity = `${entry.type}:${entry.id}`
        if (seen.has(identity)) continue
        seen.add(identity)
        order.push(entry)
      }
      byBranch[branchName] = order
    }
    if (Object.keys(byBranch).length > 0) normalized[safeRepoId] = byBranch
  }
  return normalized
}

function normalizeSession(value: unknown): WorkspaceSessionState {
  if (!value || typeof value !== 'object') return defaultSession()
  const partial = value as Partial<WorkspaceSessionState>
  const openRepoEntries = Array.isArray(partial.openRepoEntries)
    ? dedupeRepoEntries(
        partial.openRepoEntries
          .map(toSafeSessionRepoEntry)
          .filter((entry): entry is RepoSessionEntry => entry !== null),
      )
    : []
  const activeRepoId = toSafeRepoLocator(partial.activeRepoId)
  const workspacePaneTabOrderByBranchByRepo = normalizeWorkspacePaneTabOrderByBranchByRepo(
    partial.workspacePaneTabOrderByBranchByRepo,
    openRepoEntries,
  )
  return {
    openRepoEntries,
    activeRepoId:
      activeRepoId && openRepoEntries.some((entry) => repoSessionEntryId(entry) === activeRepoId) ? activeRepoId : null,
    zenMode: typeof partial.zenMode === 'boolean' ? partial.zenMode : DEFAULT_ZEN_MODE,
    workspacePaneSize: normalizeWorkspacePaneSize(partial.workspacePaneSize),
    selectedTerminalSessionByWorktree: normalizeSelectedTerminalSessionByWorktree(
      partial.selectedTerminalSessionByWorktree,
    ),
    preferredWorkspacePaneTabByBranchByRepo: normalizePreferredWorkspacePaneTabByBranchByRepo(
      partial.preferredWorkspacePaneTabByBranchByRepo,
      openRepoEntries,
      workspacePaneTabOrderByBranchByRepo,
    ),
    workspacePaneTabOrderByBranchByRepo,
  }
}

function workspacePaneStaticViews(order: readonly WorkspacePaneTabOrderEntry[]): WorkspacePaneStaticTabType[] {
  return order.flatMap((entry) => (entry.type === 'terminal' ? [] : [entry.type]))
}

function normalizeRecentRepos(value: unknown): RepoSessionEntry[] {
  if (!Array.isArray(value)) return []
  return dedupeRepoEntries(
    value.map(toSafeSessionRepoEntry).filter((entry): entry is RepoSessionEntry => entry !== null),
  ).slice(0, MAX_RECENT_REPOS)
}

function normalizeWorktreeBootstrapTrust(value: unknown): WorktreeBootstrapTrust | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Partial<WorktreeBootstrapTrust>
  if (!isWorktreeBootstrapConfigHash(raw.configHash)) return undefined
  if (typeof raw.trustedAt !== 'string' || Number.isNaN(Date.parse(raw.trustedAt))) return undefined
  return {
    configHash: raw.configHash,
    trustedAt: raw.trustedAt,
  }
}

function normalizeRepoSettings(value: unknown): RepoSettingsEntry[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const normalized: RepoSettingsEntry[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Partial<RepoSettingsEntry>
    const repoId = toSafeRepoLocator(raw.repoId)
    if (!repoId || seen.has(repoId)) continue
    seen.add(repoId)
    const entry: RepoSettingsEntry = { repoId }
    const worktreeBootstrapTrust = normalizeWorktreeBootstrapTrust(raw.worktreeBootstrapTrust)
    if (worktreeBootstrapTrust) entry.worktreeBootstrapTrust = worktreeBootstrapTrust
    normalized.push(entry)
  }
  return normalized
}

function cloneRepoSettings(repoSettings: readonly RepoSettingsEntry[]): RepoSettingsEntry[] {
  return repoSettings.map((entry) => ({
    repoId: entry.repoId,
    ...(entry.worktreeBootstrapTrust
      ? {
          worktreeBootstrapTrust: {
            configHash: entry.worktreeBootstrapTrust.configHash,
            trustedAt: entry.worktreeBootstrapTrust.trustedAt,
          },
        }
      : {}),
  }))
}

async function readUserSettingsFile(): Promise<UserSettingsData | null> {
  try {
    const raw = await readFile(serverDataFile('user-settings.json'), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<UserSettingsData>
    return {
      lang: normalizeLangPref(parsed.lang),
      theme: normalizeThemePref(parsed.theme),
      colorTheme: normalizeColorTheme(parsed.colorTheme),
      fetchIntervalSec: normalizeFetchInterval(parsed.fetchIntervalSec),
      terminalNotificationsEnabled: normalizeTerminalNotificationsEnabled(parsed.terminalNotificationsEnabled),
      shortcutsDisabled: parsed.shortcutsDisabled === true,
      globalShortcutDisabled: parsed.globalShortcutDisabled === true,
      globalShortcut: normalizeGlobalShortcut(parsed.globalShortcut),
      lanEnabled: normalizeLanEnabled(parsed.lanEnabled),
      session: normalizeSession(parsed.session),
      recentRepos: normalizeRecentRepos(parsed.recentRepos),
      repoSettings: normalizeRepoSettings(parsed.repoSettings),
    }
  } catch {
    return null
  }
}

async function writeUserSettingsFile(data: UserSettingsData): Promise<void> {
  const file = serverDataFile('user-settings.json')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(data, null, 2), 'utf-8')
}

async function loadUserSettings(): Promise<UserSettingsData> {
  settingsPromise ??= (async () => {
    const persisted = await readUserSettingsFile()
    const data = persisted ?? {
      ...defaultUserSettings(),
      session: defaultSession(),
      recentRepos: [],
      repoSettings: [],
    }
    await writeUserSettingsFile(data)
    cachedFetchIntervalSec = data.fetchIntervalSec
    return data
  })()
  return await settingsPromise
}

export async function getServerFetchIntervalSec(): Promise<number> {
  await loadUserSettings()
  return cachedFetchIntervalSec
}

export async function getUserSettings(): Promise<UserSettings> {
  return userSettingsFromData(await loadUserSettings())
}

export function subscribeServerFetchInterval(listener: FetchIntervalListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function setServerFetchIntervalSec(sec: number): Promise<number> {
  const data = await loadUserSettings()
  const next = normalizeFetchInterval(sec)
  if (data.fetchIntervalSec !== next) {
    data.fetchIntervalSec = next
    await writeUserSettingsFile(data)
  }
  if (cachedFetchIntervalSec !== next) {
    cachedFetchIntervalSec = next
    for (const listener of listeners) listener(next)
  }
  return next
}

export async function updateUserSettings(patch: UserSettingsPatch): Promise<UserSettings> {
  const data = await loadUserSettings()
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
  const nextGlobalShortcut =
    patch.globalShortcut === undefined ? data.globalShortcut : normalizeGlobalShortcut(patch.globalShortcut)
  const nextLanEnabled = patch.lanEnabled === undefined ? data.lanEnabled : normalizeLanEnabled(patch.lanEnabled)
  const changed =
    data.lang !== nextLang ||
    data.theme !== nextTheme ||
    data.colorTheme !== nextColorTheme ||
    data.fetchIntervalSec !== nextFetchIntervalSec ||
    data.terminalNotificationsEnabled !== nextTerminalNotificationsEnabled ||
    data.shortcutsDisabled !== nextShortcutsDisabled ||
    data.globalShortcutDisabled !== nextGlobalShortcutDisabled ||
    data.globalShortcut !== nextGlobalShortcut ||
    data.lanEnabled !== nextLanEnabled
  data.lang = nextLang
  data.theme = nextTheme
  data.colorTheme = nextColorTheme
  data.fetchIntervalSec = nextFetchIntervalSec
  data.terminalNotificationsEnabled = nextTerminalNotificationsEnabled
  data.shortcutsDisabled = nextShortcutsDisabled
  data.globalShortcutDisabled = nextGlobalShortcutDisabled
  data.globalShortcut = nextGlobalShortcut
  data.lanEnabled = nextLanEnabled
  if (changed) await writeUserSettingsFile(data)
  if (cachedFetchIntervalSec !== nextFetchIntervalSec) {
    cachedFetchIntervalSec = nextFetchIntervalSec
    for (const listener of listeners) listener(nextFetchIntervalSec)
  }
  return userSettingsFromData(data)
}

export async function getServerSessionState(): Promise<WorkspaceSessionState> {
  return (await loadUserSettings()).session
}

export async function setServerSessionState(session: WorkspaceSessionState): Promise<WorkspaceSessionState> {
  const data = await loadUserSettings()
  const next = normalizeSession(session)
  data.session = next
  await writeUserSettingsFile(data)
  return next
}

export async function getServerRecentRepos(): Promise<RepoSessionEntry[]> {
  return [...(await loadUserSettings()).recentRepos]
}

export async function getServerRepoSettings(): Promise<RepoSettingsEntry[]> {
  return cloneRepoSettings((await loadUserSettings()).repoSettings)
}

export async function trustServerRepoWorktreeBootstrapConfig(input: {
  repoId: string
  configHash: string
}): Promise<RepoSettingsEntry[]> {
  const data = await loadUserSettings()
  const repoId = toSafeRepoLocator(input.repoId)
  if (!repoId || !isWorktreeBootstrapConfigHash(input.configHash)) return cloneRepoSettings(data.repoSettings)
  const worktreeBootstrapTrust: WorktreeBootstrapTrust = {
    configHash: input.configHash,
    trustedAt: new Date().toISOString(),
  }
  const existingIndex = data.repoSettings.findIndex((entry) => entry.repoId === repoId)
  if (existingIndex >= 0) {
    data.repoSettings = data.repoSettings.map((entry, index) =>
      index === existingIndex ? { ...entry, worktreeBootstrapTrust } : entry,
    )
  } else {
    data.repoSettings = [...data.repoSettings, { repoId, worktreeBootstrapTrust }]
  }
  await writeUserSettingsFile(data)
  return cloneRepoSettings(data.repoSettings)
}

export async function addServerRecentRepo(repo: RepoSessionEntry): Promise<RepoSessionEntry[]> {
  const data = await loadUserSettings()
  const safeRepo = toSafeSessionRepoEntry(repo)
  if (!safeRepo) return [...data.recentRepos]
  const safeId = repoSessionEntryId(safeRepo)
  data.recentRepos = [safeRepo, ...data.recentRepos.filter((entry) => repoSessionEntryId(entry) !== safeId)].slice(
    0,
    MAX_RECENT_REPOS,
  )
  await writeUserSettingsFile(data)
  return [...data.recentRepos]
}

export async function clearServerRecentRepos(): Promise<void> {
  const data = await loadUserSettings()
  if (data.recentRepos.length === 0) return
  data.recentRepos = []
  await writeUserSettingsFile(data)
}

export function resetServerSettingsSourceForTests(): void {
  settingsPromise = null
  listeners.clear()
  cachedFetchIntervalSec = DEFAULT_FETCH_INTERVAL_SEC
}
