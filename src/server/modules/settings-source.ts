import path from 'node:path'
import {
  MAX_IPC_PATH_LENGTH,
  toSafeRepoLocator,
  toSafeSessionPath,
  toSafeSessionRepoEntry,
} from '#/shared/input-validation.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import {
  readUserSettingsJson,
  resetUserSettingsPersistenceForTests,
  writeUserSettingsJson,
} from '#/server/modules/settings-persistence.ts'
import type {
  FiletreeSessionViewState,
  LangPref,
  WorkspaceSessionState,
  UserSettings,
  ThemePref,
} from '#/shared/api-types.ts'
import { DEFAULT_ZEN_MODE, normalizeWorkspacePaneSize } from '#/shared/workspace-layout.ts'
import { repoSessionEntryId, type RepoSessionEntry } from '#/shared/remote-repo.ts'
import {
  isKnownWorkspaceExternalAppItemId,
  isWorktreeBootstrapConfigHash,
  type RepoSettingsEntry,
  type WorkspaceExternalAppRecent,
  type WorktreeBootstrapTrust,
  workspaceExternalAppRecentKey,
} from '#/shared/repo-settings.ts'
import {
  isWorkspacePaneSessionTabType,
  isWorkspacePaneRuntimeTabEntry,
  isWorkspacePaneStaticTabType,
  type WorkspacePaneSessionTabType,
  type WorkspacePaneStaticTabType,
  type WorkspacePaneTabEntry,
  workspacePaneTabEntryFromUnknown,
  workspacePaneTabEntryIdentity,
  workspacePaneTabRequiresWorktree,
} from '#/shared/workspace-pane.ts'
import {
  parseWorkspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTargetIdentity,
} from '#/shared/workspace-pane-tabs-target.ts'
import { normalizeGlobalShortcut } from '#/shared/accelerator.ts'
import { isColorTheme, type ColorTheme } from '#/shared/color-theme.ts'
import {
  DEFAULT_COLOR_THEME,
  DEFAULT_FETCH_INTERVAL_SEC,
  DEFAULT_LANG_PREF,
  DEFAULT_THEME_PREF,
  MAX_RECENT_REPOS,
  defaultUserSettings,
  defaultWorkspaceSessionState,
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
let settingsData: UserSettingsData | null = null
let settingsLoadPromise: Promise<UserSettingsData> | null = null
let settingsMutationPromise: Promise<void> = Promise.resolve()
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
  return defaultWorkspaceSessionState()
}

function normalizeSelectedTerminalSessionIdByTerminalWorktree(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const normalized: Record<string, string> = {}
  for (const [terminalWorktreeKey, terminalSessionId] of Object.entries(value)) {
    if (
      typeof terminalWorktreeKey !== 'string' ||
      typeof terminalSessionId !== 'string' ||
      terminalSessionId.length === 0
    )
      continue
    const parts = terminalWorktreeKey.split('\0')
    if (parts.length !== 2 || !parts[0] || !parts[1]) continue
    normalized[terminalWorktreeKey] = terminalSessionId
  }
  return normalized
}

function normalizePreferredWorkspacePaneTabByTargetByRepo(
  value: unknown,
  openRepoEntries: RepoSessionEntry[],
  tabsByRepo: Record<string, Record<string, WorkspacePaneTabEntry[]>>,
): Record<string, Record<string, WorkspacePaneSessionTabType>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const openRepoIds = new Set(openRepoEntries.map(repoSessionEntryId))
  const normalized: Record<string, Record<string, WorkspacePaneSessionTabType>> = {}
  for (const [repoId, rawByTarget] of Object.entries(value)) {
    const safeRepoId = toSafeRepoLocator(repoId)
    if (
      !safeRepoId ||
      !openRepoIds.has(safeRepoId) ||
      !rawByTarget ||
      typeof rawByTarget !== 'object' ||
      Array.isArray(rawByTarget)
    )
      continue
    const byTarget: Record<string, WorkspacePaneSessionTabType> = {}
    for (const [targetKey, paneTab] of Object.entries(rawByTarget)) {
      const target = safeWorkspacePaneTabsTargetIdentity(safeRepoId, targetKey)
      if (!target) continue
      if (typeof paneTab !== 'string' || !isWorkspacePaneSessionTabType(paneTab)) continue
      if (target.kind === 'branch' && workspacePaneTabRequiresWorktree(paneTab)) continue
      if (
        isWorkspacePaneStaticTabType(paneTab) &&
        !workspacePaneStaticTabs(tabsByRepo[safeRepoId]?.[targetKey] ?? []).includes(paneTab)
      )
        continue
      byTarget[targetKey] = paneTab
    }
    if (Object.keys(byTarget).length > 0) normalized[safeRepoId] = byTarget
  }
  return normalized
}

function normalizeWorkspacePaneTabsByTargetByRepo(
  value: unknown,
  openRepoEntries: RepoSessionEntry[],
): Record<string, Record<string, WorkspacePaneTabEntry[]>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const openRepoIds = new Set(openRepoEntries.map(repoSessionEntryId))
  const normalized: Record<string, Record<string, WorkspacePaneTabEntry[]>> = {}
  for (const [repoId, rawByTarget] of Object.entries(value)) {
    const safeRepoId = toSafeRepoLocator(repoId)
    if (
      !safeRepoId ||
      !openRepoIds.has(safeRepoId) ||
      !rawByTarget ||
      typeof rawByTarget !== 'object' ||
      Array.isArray(rawByTarget)
    )
      continue
    const byTarget: Record<string, WorkspacePaneTabEntry[]> = {}
    for (const [targetKey, rawTabs] of Object.entries(rawByTarget)) {
      const target = safeWorkspacePaneTabsTargetIdentity(safeRepoId, targetKey)
      if (!target || !Array.isArray(rawTabs)) continue
      const tabs: WorkspacePaneTabEntry[] = []
      const seen = new Set<string>()
      for (const raw of rawTabs) {
        const entry = workspacePaneTabEntryFromUnknown(raw)
        if (!entry) continue
        if (target.kind === 'branch' && workspacePaneTabRequiresWorktree(entry.type)) continue
        const identity = workspacePaneTabEntryIdentity(entry)
        if (seen.has(identity)) continue
        seen.add(identity)
        tabs.push(entry)
      }
      byTarget[targetKey] = tabs
    }
    if (Object.keys(byTarget).length > 0) normalized[safeRepoId] = byTarget
  }
  return normalized
}

function safeWorkspacePaneTabsTargetIdentity(
  repoId: string,
  targetKey: string,
): WorkspacePaneTabsTargetIdentity | null {
  const parsed = parseWorkspacePaneTabsTargetIdentityKey(targetKey)
  if (!parsed || parsed.repoRoot !== repoId) return null
  if (parsed.kind === 'branch') return isSafeBranchName(parsed.branchName) ? parsed : null
  return toSafeSessionPath(parsed.worktreePath) === parsed.worktreePath ? parsed : null
}

function normalizeFiletreeViewStateByWorktreeByRepo(
  value: unknown,
  openRepoEntries: RepoSessionEntry[],
): Record<string, Record<string, FiletreeSessionViewState>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const openRepoIds = new Set(openRepoEntries.map(repoSessionEntryId))
  const normalized: Record<string, Record<string, FiletreeSessionViewState>> = {}
  for (const [repoId, rawByWorktree] of Object.entries(value)) {
    const safeRepoId = toSafeRepoLocator(repoId)
    if (
      !safeRepoId ||
      !openRepoIds.has(safeRepoId) ||
      !rawByWorktree ||
      typeof rawByWorktree !== 'object' ||
      Array.isArray(rawByWorktree)
    )
      continue
    const byWorktree: Record<string, FiletreeSessionViewState> = {}
    for (const [worktreePath, rawViewState] of Object.entries(rawByWorktree)) {
      if (!worktreePath || worktreePath.includes('\0')) continue
      const viewState = normalizeFiletreeViewState(rawViewState)
      if (!viewState) continue
      if (
        viewState.selectedKeys.length === 0 &&
        viewState.expandedKeys.length === 0 &&
        viewState.topVisibleRowIndex === 0
      )
        continue
      byWorktree[worktreePath] = viewState
    }
    if (Object.keys(byWorktree).length > 0) normalized[safeRepoId] = byWorktree
  }
  return normalized
}

function normalizeFiletreeViewState(value: unknown): FiletreeSessionViewState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<FiletreeSessionViewState>
  return {
    selectedKeys: normalizeFiletreeKeys(raw.selectedKeys),
    expandedKeys: normalizeFiletreeKeys(raw.expandedKeys),
    topVisibleRowIndex: normalizeFiletreeTopVisibleRowIndex(raw.topVisibleRowIndex),
  }
}

function normalizeFiletreeKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const key of value) {
    if (typeof key !== 'string' || !key || key.includes('\0') || seen.has(key)) continue
    seen.add(key)
    normalized.push(key)
  }
  return normalized
}

function normalizeFiletreeTopVisibleRowIndex(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
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
  const restoredRepoId = toSafeRepoLocator(partial.restoredRepoId)
  const workspacePaneTabsByTargetByRepo = normalizeWorkspacePaneTabsByTargetByRepo(
    partial.workspacePaneTabsByTargetByRepo,
    openRepoEntries,
  )
  return {
    openRepoEntries,
    restoredRepoId:
      restoredRepoId && openRepoEntries.some((entry) => repoSessionEntryId(entry) === restoredRepoId)
        ? restoredRepoId
        : null,
    zenMode: typeof partial.zenMode === 'boolean' ? partial.zenMode : DEFAULT_ZEN_MODE,
    workspacePaneSize: normalizeWorkspacePaneSize(partial.workspacePaneSize),
    selectedTerminalSessionIdByTerminalWorktree: normalizeSelectedTerminalSessionIdByTerminalWorktree(
      partial.selectedTerminalSessionIdByTerminalWorktree,
    ),
    preferredWorkspacePaneTabByTargetByRepo: normalizePreferredWorkspacePaneTabByTargetByRepo(
      partial.preferredWorkspacePaneTabByTargetByRepo,
      openRepoEntries,
      workspacePaneTabsByTargetByRepo,
    ),
    workspacePaneTabsByTargetByRepo,
    filetreeViewStateByWorktreeByRepo: normalizeFiletreeViewStateByWorktreeByRepo(
      partial.filetreeViewStateByWorktreeByRepo,
      openRepoEntries,
    ),
  }
}

function workspacePaneStaticTabs(tabs: readonly WorkspacePaneTabEntry[]): WorkspacePaneStaticTabType[] {
  return tabs.flatMap((entry) => (isWorkspacePaneRuntimeTabEntry(entry) ? [] : [entry.type]))
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

function normalizeWorkspaceExternalAppRecent(value: unknown): WorkspaceExternalAppRecent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Partial<WorkspaceExternalAppRecent>
  if (!raw.byWorktree || typeof raw.byWorktree !== 'object' || Array.isArray(raw.byWorktree)) return undefined
  const byWorktree: Record<string, string> = {}
  for (const [worktreePath, itemId] of Object.entries(raw.byWorktree)) {
    if (typeof worktreePath !== 'string' || worktreePath.includes('\0')) continue
    // Empty string is the reserved key for "no worktree" (bare repo);
    // any other key must be an absolute path with no NULs.
    if (worktreePath !== '' && (!path.isAbsolute(worktreePath) || worktreePath.length > MAX_IPC_PATH_LENGTH)) continue
    if (!isKnownWorkspaceExternalAppItemId(itemId)) continue
    byWorktree[worktreePath] = itemId
  }
  if (Object.keys(byWorktree).length === 0) return undefined
  return { byWorktree }
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
    const workspaceExternalAppRecent = normalizeWorkspaceExternalAppRecent(raw.workspaceExternalAppRecent)
    if (workspaceExternalAppRecent) entry.workspaceExternalAppRecent = workspaceExternalAppRecent
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
    ...(entry.workspaceExternalAppRecent
      ? { workspaceExternalAppRecent: { byWorktree: { ...entry.workspaceExternalAppRecent.byWorktree } } }
      : {}),
  }))
}

function cloneSession(session: WorkspaceSessionState): WorkspaceSessionState {
  return normalizeSession(session)
}

async function readUserSettingsFile(): Promise<UserSettingsData | null> {
  const raw = await readUserSettingsJson()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const parsed = raw as Partial<UserSettingsData>
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
}

async function writeUserSettingsFile(data: UserSettingsData): Promise<void> {
  await writeUserSettingsJson(data)
}

async function loadUserSettings(): Promise<UserSettingsData> {
  if (settingsData) return settingsData
  settingsLoadPromise ??= (async () => {
    const persisted = await readUserSettingsFile()
    let data: UserSettingsData
    if (persisted) {
      data = persisted
    } else {
      data = {
        ...defaultUserSettings(),
        session: defaultSession(),
        recentRepos: [],
        repoSettings: [],
      }
      await writeUserSettingsFile(data)
    }
    settingsData = data
    cachedFetchIntervalSec = data.fetchIntervalSec
    return data
  })().catch((err) => {
    settingsLoadPromise = null
    throw err
  })
  return await settingsLoadPromise
}

interface UserSettingsMutation<T> {
  next: UserSettingsData
  result: T
  changed?: boolean
  afterCommit?: () => void
}

function unchangedUserSettings<T>(data: UserSettingsData, result: T): UserSettingsMutation<T> {
  return { next: data, result, changed: false }
}

async function mutateUserSettings<T>(
  mutation: (data: UserSettingsData) => Promise<UserSettingsMutation<T>> | UserSettingsMutation<T>,
): Promise<T> {
  let result!: T
  const run = settingsMutationPromise
    .catch(() => {})
    .then(async () => {
      const current = await loadUserSettings()
      const commit = await mutation(current)
      if (commit.changed !== false) {
        await writeUserSettingsFile(commit.next)
        settingsData = commit.next
        settingsLoadPromise = Promise.resolve(commit.next)
      }
      commit.afterCommit?.()
      result = commit.result
    })
  settingsMutationPromise = run.then(
    () => {},
    () => {},
  )
  await run
  return result!
}

/**
 * Apply a patch to the `RepoSettingsEntry` matching `repoId`, creating the
 * entry if it doesn't exist. The patch receives the current entry (or
 * `undefined`) and returns the new entry, or `null` to skip the update
 * entirely (used by callers that want to no-op on unchanged values).
 * Returns the updated list, or `null` when the patch is a no-op.
 */
function updateRepoSettingsEntry(
  repoSettings: readonly RepoSettingsEntry[],
  repoId: string,
  patch: (existing: RepoSettingsEntry | undefined) => RepoSettingsEntry | null,
): RepoSettingsEntry[] | null {
  const existingIndex = repoSettings.findIndex((entry) => entry.repoId === repoId)
  const existing = existingIndex >= 0 ? repoSettings[existingIndex] : undefined
  const next = patch(existing)
  if (next === null) return null
  if (existingIndex >= 0) {
    return repoSettings.map((entry, index) => (index === existingIndex ? next : entry))
  }
  return [...repoSettings, next]
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
  return await mutateUserSettings(async (data) => {
    const next = normalizeFetchInterval(sec)
    const changed = data.fetchIntervalSec !== next
    return {
      next: changed ? { ...data, fetchIntervalSec: next } : data,
      result: next,
      changed,
      afterCommit: () => {
        if (cachedFetchIntervalSec !== next) {
          cachedFetchIntervalSec = next
          for (const listener of listeners) listener(next)
        }
      },
    }
  })
}

export async function updateUserSettings(patch: UserSettingsPatch): Promise<UserSettings> {
  return await mutateUserSettings(async (data) => {
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
    const nextData: UserSettingsData = changed
      ? {
          ...data,
          lang: nextLang,
          theme: nextTheme,
          colorTheme: nextColorTheme,
          fetchIntervalSec: nextFetchIntervalSec,
          terminalNotificationsEnabled: nextTerminalNotificationsEnabled,
          shortcutsDisabled: nextShortcutsDisabled,
          globalShortcutDisabled: nextGlobalShortcutDisabled,
          globalShortcut: nextGlobalShortcut,
          lanEnabled: nextLanEnabled,
        }
      : data
    return {
      next: nextData,
      result: userSettingsFromData(nextData),
      changed,
      afterCommit: () => {
        if (cachedFetchIntervalSec !== nextFetchIntervalSec) {
          cachedFetchIntervalSec = nextFetchIntervalSec
          for (const listener of listeners) listener(nextFetchIntervalSec)
        }
      },
    }
  })
}

export async function getServerSessionState(): Promise<WorkspaceSessionState> {
  return cloneSession((await loadUserSettings()).session)
}

export async function setServerSessionState(session: WorkspaceSessionState): Promise<WorkspaceSessionState> {
  return await mutateUserSettings(async (data) => {
    const next = normalizeSession(session)
    return {
      next: { ...data, session: next },
      result: cloneSession(next),
    }
  })
}

export async function saveRebuiltServerSessionState(input: {
  persistedSnapshot: WorkspaceSessionState
  rebuiltSession: WorkspaceSessionState
}): Promise<{ saved: true; session: WorkspaceSessionState } | { saved: false; latestSession: WorkspaceSessionState }> {
  return await mutateUserSettings<
    { saved: true; session: WorkspaceSessionState } | { saved: false; latestSession: WorkspaceSessionState }
  >(async (data) => {
    const current = cloneSession(data.session)
    if (!sameWorkspaceSessionState(current, input.persistedSnapshot)) {
      return unchangedUserSettings(data, { saved: false, latestSession: current })
    }
    const next = normalizeSession(input.rebuiltSession)
    return {
      next: { ...data, session: next },
      result: { saved: true, session: cloneSession(next) },
    }
  })
}

function sameWorkspaceSessionState(a: WorkspaceSessionState, b: WorkspaceSessionState): boolean {
  return JSON.stringify(normalizeSession(a)) === JSON.stringify(normalizeSession(b))
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
  return await mutateUserSettings(async (data) => {
    const repoId = toSafeRepoLocator(input.repoId)
    if (!repoId || !isWorktreeBootstrapConfigHash(input.configHash)) {
      return unchangedUserSettings(data, cloneRepoSettings(data.repoSettings))
    }
    const worktreeBootstrapTrust: WorktreeBootstrapTrust = {
      configHash: input.configHash,
      trustedAt: new Date().toISOString(),
    }
    const repoSettings = updateRepoSettingsEntry(data.repoSettings, repoId, (existing) => ({
      repoId,
      ...existing,
      worktreeBootstrapTrust,
    }))
    const nextData = repoSettings ? { ...data, repoSettings } : data
    return {
      next: nextData,
      result: cloneRepoSettings(nextData.repoSettings),
      changed: repoSettings !== null,
    }
  })
}

export async function untrustServerRepoWorktreeBootstrapConfig(input: {
  repoId: string
  configHash: string
}): Promise<boolean> {
  return await mutateUserSettings(async (data) => {
    const repoId = toSafeRepoLocator(input.repoId)
    if (!repoId || !isWorktreeBootstrapConfigHash(input.configHash)) return unchangedUserSettings(data, false)
    const existingIndex = data.repoSettings.findIndex((entry) => entry.repoId === repoId)
    if (existingIndex < 0) return unchangedUserSettings(data, false)
    const existing = data.repoSettings[existingIndex]
    if (existing.worktreeBootstrapTrust?.configHash !== input.configHash) return unchangedUserSettings(data, false)

    const nextEntry: RepoSettingsEntry = { ...existing }
    delete nextEntry.worktreeBootstrapTrust
    if (nextEntry.workspaceExternalAppRecent) {
      const repoSettings = data.repoSettings.map((entry, index) => (index === existingIndex ? nextEntry : entry))
      return { next: { ...data, repoSettings }, result: true }
    } else {
      const repoSettings = data.repoSettings.filter((_, index) => index !== existingIndex)
      return { next: { ...data, repoSettings }, result: true }
    }
  })
}

/**
 * Record the most recently chosen workspace external app id for a
 * (repo, worktree) scope. The split-button primary in the workspace
 * toolbar reads this on mount. No-op when the value is already current
 * — callers can fire on every selection without coordinating with the
 * server.
 */
export async function setServerRepoWorkspaceExternalAppRecent(input: {
  repoId: string
  worktreePath: string | null
  itemId: string
}): Promise<RepoSettingsEntry[]> {
  return await mutateUserSettings(async (data) => {
    const repoId = toSafeRepoLocator(input.repoId)
    // Validate the worktree key: `null`/`undefined` collapses to "" (bare
    // repo); otherwise the path must be a normalized absolute path with
    // no NULs. `toSafeSessionPath` encodes the same validation used
    // elsewhere in the codebase, so the rules can't drift.
    const isBareRepoScope = input.worktreePath === null || input.worktreePath === undefined
    const safeWorktreePath = isBareRepoScope ? null : toSafeSessionPath(input.worktreePath)
    if (
      !repoId ||
      (!isBareRepoScope && safeWorktreePath === null) ||
      !isKnownWorkspaceExternalAppItemId(input.itemId)
    ) {
      return unchangedUserSettings(data, cloneRepoSettings(data.repoSettings))
    }
    const worktreeKey = workspaceExternalAppRecentKey(safeWorktreePath)
    // No-op when the value hasn't changed — keeps a no-op click from
    // triggering a full user-settings.json rewrite.
    const repoSettings = updateRepoSettingsEntry(data.repoSettings, repoId, (existing) => {
      const existingByWorktree = existing?.workspaceExternalAppRecent?.byWorktree ?? {}
      if (existingByWorktree[worktreeKey] === input.itemId) return null
      return {
        repoId,
        ...existing,
        workspaceExternalAppRecent: { byWorktree: { ...existingByWorktree, [worktreeKey]: input.itemId } },
      }
    })
    const nextData = repoSettings ? { ...data, repoSettings } : data
    return {
      next: nextData,
      result: cloneRepoSettings(nextData.repoSettings),
      changed: repoSettings !== null,
    }
  })
}

/**
 * Prune repo settings that are scoped to a worktree path after that worktree
 * has been removed. Repo-level settings, such as bootstrap trust, stay intact.
 * Returns true when the settings file changed.
 */
export async function pruneServerRepoSettingsForRemovedWorktree(input: {
  repoId: string
  worktreePath: string
}): Promise<boolean> {
  return await mutateUserSettings(async (data) => {
    const repoId = toSafeRepoLocator(input.repoId)
    const safeWorktreePath = toSafeSessionPath(input.worktreePath)
    if (!repoId || safeWorktreePath === null) return unchangedUserSettings(data, false)
    const worktreeKey = workspaceExternalAppRecentKey(safeWorktreePath)
    const existingIndex = data.repoSettings.findIndex((entry) => entry.repoId === repoId)
    if (existingIndex < 0) return unchangedUserSettings(data, false)
    const existing = data.repoSettings[existingIndex]
    const existingByWorktree = existing.workspaceExternalAppRecent?.byWorktree
    if (!existingByWorktree || !(worktreeKey in existingByWorktree)) return unchangedUserSettings(data, false)

    const nextByWorktree = { ...existingByWorktree }
    delete nextByWorktree[worktreeKey]
    const nextEntry: RepoSettingsEntry = { ...existing }
    if (Object.keys(nextByWorktree).length > 0) {
      nextEntry.workspaceExternalAppRecent = { byWorktree: nextByWorktree }
    } else {
      delete nextEntry.workspaceExternalAppRecent
    }

    const repoSettings =
      nextEntry.worktreeBootstrapTrust || nextEntry.workspaceExternalAppRecent
        ? data.repoSettings.map((entry, index) => (index === existingIndex ? nextEntry : entry))
        : data.repoSettings.filter((_, index) => index !== existingIndex)
    return { next: { ...data, repoSettings }, result: true }
  })
}

export async function addServerRecentRepo(repo: RepoSessionEntry): Promise<RepoSessionEntry[]> {
  return await mutateUserSettings(async (data) => {
    const safeRepo = toSafeSessionRepoEntry(repo)
    if (!safeRepo) return unchangedUserSettings(data, [...data.recentRepos])
    const safeId = repoSessionEntryId(safeRepo)
    const recentRepos = [safeRepo, ...data.recentRepos.filter((entry) => repoSessionEntryId(entry) !== safeId)].slice(
      0,
      MAX_RECENT_REPOS,
    )
    return { next: { ...data, recentRepos }, result: [...recentRepos] }
  })
}

export async function clearServerRecentRepos(): Promise<void> {
  await mutateUserSettings(async (data) => {
    if (data.recentRepos.length === 0) return { next: data, result: undefined, changed: false }
    return { next: { ...data, recentRepos: [] }, result: undefined }
  })
}

export function resetServerSettingsSourceForTests(): void {
  settingsData = null
  settingsLoadPromise = null
  settingsMutationPromise = Promise.resolve()
  listeners.clear()
  cachedFetchIntervalSec = DEFAULT_FETCH_INTERVAL_SEC
  resetUserSettingsPersistenceForTests()
}
