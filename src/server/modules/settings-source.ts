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
import type { LangPref, ServerWorkspaceState, UserSettings, ThemePref } from '#/shared/api-types.ts'
import { repoSessionEntryId, sameRepoSessionEntry, type RepoSessionEntry } from '#/shared/remote-repo.ts'
import { recordWithoutKey } from '#/shared/record.ts'
import {
  isKnownWorkspaceExternalAppItemId,
  isWorktreeBootstrapConfigHash,
  type RepoSettingsEntry,
  type WorkspaceExternalAppRecent,
  type WorktreeBootstrapTrust,
  workspaceExternalAppRecentKey,
} from '#/shared/repo-settings.ts'
import {
  isWorkspacePaneRuntimeTabEntry,
  type WorkspacePaneStaticTabEntry,
  type WorkspacePaneTabEntry,
  workspacePaneTabEntryFromUnknown,
  workspacePaneTabEntryIdentity,
  workspacePaneTabRequiresWorktree,
} from '#/shared/workspace-pane.ts'
import {
  parseWorkspacePaneTabsTargetIdentityKey,
  workspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTargetIdentity,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneDurableLayout } from '#/shared/workspace-pane-tabs.ts'
import {
  normalizeWorkspacePaneDurableLayout,
  workspacePaneDurableLayoutsEqual,
  type WorkspacePaneLayoutRepository,
  type WorkspacePaneLayoutRepositoryCasOutcome,
} from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import { normalizeGlobalShortcut } from '#/shared/accelerator.ts'
import { isColorTheme, type ColorTheme } from '#/shared/color-theme.ts'
import {
  DEFAULT_COLOR_THEME,
  DEFAULT_FETCH_INTERVAL_SEC,
  DEFAULT_LANG_PREF,
  DEFAULT_THEME_PREF,
  MAX_RECENT_REPOS,
  defaultUserSettings,
  defaultServerWorkspaceState,
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
  workspace: ServerWorkspaceState
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

function defaultWorkspace(): ServerWorkspaceState {
  return defaultServerWorkspaceState()
}

function normalizeWorkspacePaneTabsByTargetByRepo(
  value: unknown,
): Record<string, Record<string, WorkspacePaneStaticTabEntry[]>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalized: Record<string, Record<string, WorkspacePaneStaticTabEntry[]>> = {}
  for (const [repoId, rawByTarget] of Object.entries(value)) {
    const safeRepoId = toSafeRepoLocator(repoId)
    if (!safeRepoId || !rawByTarget || typeof rawByTarget !== 'object' || Array.isArray(rawByTarget)) continue
    const byTarget: Record<string, WorkspacePaneStaticTabEntry[]> = {}
    for (const [targetKey, rawTabs] of Object.entries(rawByTarget)) {
      const target = safeWorkspacePaneTabsTargetIdentity(safeRepoId, targetKey)
      if (!target || !Array.isArray(rawTabs)) continue
      const tabs: WorkspacePaneStaticTabEntry[] = []
      const seen = new Set<string>()
      for (const raw of rawTabs) {
        const entry = workspacePaneTabEntryFromUnknown(raw)
        if (!entry || isWorkspacePaneRuntimeTabEntry(entry)) continue
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

function normalizeWorkspace(value: unknown): ServerWorkspaceState {
  if (!value || typeof value !== 'object') return defaultWorkspace()
  const partial = value as Partial<ServerWorkspaceState>
  return {
    openRepoEntries: normalizeRepoEntries(partial.openRepoEntries),
    workspacePaneTabsByTargetByRepo: normalizeWorkspacePaneTabsByTargetByRepo(partial.workspacePaneTabsByTargetByRepo),
  }
}

function normalizeRecentRepos(value: unknown): RepoSessionEntry[] {
  return normalizeRepoEntries(value).slice(0, MAX_RECENT_REPOS)
}

function normalizeRepoEntries(value: unknown): RepoSessionEntry[] {
  if (!Array.isArray(value)) return []
  return dedupeRepoEntries(
    value.map(toSafeSessionRepoEntry).filter((entry): entry is RepoSessionEntry => entry !== null),
  )
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

function cloneWorkspace(workspace: ServerWorkspaceState): ServerWorkspaceState {
  return normalizeWorkspace(workspace)
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
    workspace: normalizeWorkspace(parsed.workspace),
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
        workspace: defaultWorkspace(),
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

export async function getServerWorkspaceState(): Promise<ServerWorkspaceState> {
  return cloneWorkspace((await loadUserSettings()).workspace)
}

export async function addServerWorkspaceRepo(entry: RepoSessionEntry): Promise<ServerWorkspaceState> {
  return await mutateUserSettings(async (data) => {
    const id = repoSessionEntryId(entry)
    const existingIndex = data.workspace.openRepoEntries.findIndex((candidate) => repoSessionEntryId(candidate) === id)
    const openRepoEntries = [...data.workspace.openRepoEntries]
    if (existingIndex === -1) openRepoEntries.push(entry)
    else openRepoEntries[existingIndex] = entry
    const workspace = { ...data.workspace, openRepoEntries }
    return { next: { ...data, workspace }, result: cloneWorkspace(workspace) }
  })
}

export async function removeServerWorkspaceRepo(repoRoot: string): Promise<ServerWorkspaceState> {
  return await mutateUserSettings(async (data) => {
    const openRepoEntries = data.workspace.openRepoEntries.filter((entry) => repoSessionEntryId(entry) !== repoRoot)
    if (openRepoEntries.length === data.workspace.openRepoEntries.length) {
      return unchangedUserSettings(data, cloneWorkspace(data.workspace))
    }
    const workspace = { ...data.workspace, openRepoEntries }
    return { next: { ...data, workspace }, result: cloneWorkspace(workspace) }
  })
}

export type ServerWorkspaceMatchOutcome =
  { matched: true; workspace: ServerWorkspaceState } | { matched: false; latestWorkspace: ServerWorkspaceState }

export async function compareAndReplaceServerWorkspaceRepos(
  expected: RepoSessionEntry[],
  replacement: RepoSessionEntry[],
): Promise<ServerWorkspaceMatchOutcome> {
  return await mutateUserSettings<ServerWorkspaceMatchOutcome>(async (data) => {
    if (!sameRepoEntries(data.workspace.openRepoEntries, expected)) {
      return unchangedUserSettings(data, { matched: false, latestWorkspace: cloneWorkspace(data.workspace) })
    }
    if (sameRepoEntries(expected, replacement)) {
      return unchangedUserSettings(data, { matched: true, workspace: cloneWorkspace(data.workspace) })
    }
    const workspace = { ...data.workspace, openRepoEntries: replacement }
    return {
      next: { ...data, workspace },
      result: { matched: true, workspace: cloneWorkspace(workspace) },
    }
  })
}

export async function confirmServerWorkspaceRepoEntry(
  expected: RepoSessionEntry,
): Promise<ServerWorkspaceMatchOutcome> {
  return await mutateUserSettings<ServerWorkspaceMatchOutcome>(async (data) => {
    const current = data.workspace.openRepoEntries.find(
      (entry) => repoSessionEntryId(entry) === repoSessionEntryId(expected),
    )
    return unchangedUserSettings(
      data,
      sameRepoSessionEntry(current, expected)
        ? { matched: true, workspace: cloneWorkspace(data.workspace) }
        : { matched: false, latestWorkspace: cloneWorkspace(data.workspace) },
    )
  })
}

function sameRepoEntries(a: RepoSessionEntry[], b: RepoSessionEntry[]): boolean {
  return a.length === b.length && a.every((entry, index) => sameRepoSessionEntry(entry, b[index]))
}

function workspacePaneLayoutFromWorkspace(workspace: ServerWorkspaceState, repoRoot: string): WorkspacePaneDurableLayout {
  const entries: WorkspacePaneDurableLayout['entries'] = []
  for (const [targetKey, tabs] of Object.entries(workspace.workspacePaneTabsByTargetByRepo[repoRoot] ?? {})) {
    const target = parseWorkspacePaneTabsTargetIdentityKey(targetKey)
    if (!target || target.repoRoot !== repoRoot) continue
    entries.push(target.kind === 'branch'
      ? { repoRoot, branchName: target.branchName, worktreePath: null, tabs }
      : { repoRoot, branchName: '', worktreePath: target.worktreePath, tabs })
  }
  return normalizeWorkspacePaneDurableLayout(repoRoot, { entries })
}

export const serverWorkspacePaneLayoutRepository: WorkspacePaneLayoutRepository = {
  async load(repoRoot) {
    const workspace = (await loadUserSettings()).workspace
    return { layout: workspacePaneLayoutFromWorkspace(workspace, repoRoot) }
  },

  async compareAndSwap(input) {
    return await mutateUserSettings<WorkspacePaneLayoutRepositoryCasOutcome>(async (data) => {
      const currentLayout = workspacePaneLayoutFromWorkspace(data.workspace, input.repoRoot)
      const snapshot = { layout: currentLayout }
      if (input.expectedRepoEntry) {
        const currentRepoEntry = data.workspace.openRepoEntries.find(
          (entry) => repoSessionEntryId(entry) === input.repoRoot,
        )
        if (!sameRepoSessionEntry(currentRepoEntry, input.expectedRepoEntry)) {
          return unchangedUserSettings(data, { kind: 'membership-conflict', snapshot })
        }
      }
      if (!workspacePaneDurableLayoutsEqual(input.repoRoot, currentLayout, input.expected)) {
        return unchangedUserSettings(data, { kind: 'conflict', snapshot })
      }
      const replacement = normalizeWorkspacePaneDurableLayout(input.repoRoot, input.replacement)
      if (workspacePaneDurableLayoutsEqual(input.repoRoot, currentLayout, replacement)) {
        return unchangedUserSettings(data, { kind: 'accepted', snapshot, changed: false })
      }
      const byTarget = Object.fromEntries(
        replacement.entries.map((entry) => [workspacePaneTabsTargetIdentityKey(entry), entry.tabs]),
      )
      const workspacePaneTabsByTargetByRepo = Object.keys(byTarget).length === 0
        ? recordWithoutKey(data.workspace.workspacePaneTabsByTargetByRepo, input.repoRoot)
        : { ...data.workspace.workspacePaneTabsByTargetByRepo, [input.repoRoot]: byTarget }
      const workspace = normalizeWorkspace({ ...data.workspace, workspacePaneTabsByTargetByRepo })
      const committed = { layout: workspacePaneLayoutFromWorkspace(workspace, input.repoRoot) }
      return {
        next: { ...data, workspace },
        result: { kind: 'accepted', snapshot: committed, changed: true },
      }
    })
  },
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
