import path from 'node:path'
import {
  MAX_IPC_PATH_LENGTH,
  toSafeWorkspaceLocator,
  toSafeSessionPath,
  toSafeWorkspaceSessionEntry,
} from '#/shared/input-validation.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import {
  readUserSettingsJson,
  resetUserSettingsPersistenceForTests,
  SettingsPersistenceWriteError,
  writeUserSettingsJson,
} from '#/server/modules/settings-persistence.ts'
import type { LangPref, ServerWorkspaceState, UserSettings, ThemePref } from '#/shared/api-types.ts'
import {
  workspaceSessionEntryId,
  sameWorkspaceSessionEntry,
  type WorkspaceSessionEntry,
} from '#/shared/remote-workspace.ts'
import { recordWithoutKey } from '#/shared/record.ts'
import {
  isKnownWorkspaceExternalAppItemId,
  isWorktreeBootstrapConfigHash,
  type WorkspaceSettingsEntry,
  type WorkspaceExternalAppRecent,
  type WorktreeBootstrapTrust,
  workspaceExternalAppRecentKey,
} from '#/shared/workspace-settings.ts'
import {
  isWorkspacePaneRuntimeTabEntry,
  type WorkspacePaneStaticTabEntry,
  type WorkspacePaneTabEntry,
  workspacePaneTabEntryFromUnknown,
  workspacePaneTabEntryIdentity,
  workspacePaneTabRequiresWorktree,
} from '#/shared/workspace-pane.ts'
import {
  parseRestorableWorkspacePaneTargetKey,
  restorableWorkspacePaneTarget,
  restorableWorkspacePaneTargetKey,
  workspacePaneTabsTargetFromRestorable,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { RestorableWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneDurableLayout } from '#/shared/workspace-pane-tabs.ts'
import {
  normalizeWorkspacePaneDurableLayout,
  workspacePaneDurableLayoutsEqual,
  type WorkspacePaneLayoutRepositoryCasInput,
  type WorkspacePaneLayoutRepository,
  type WorkspacePaneLayoutRepositoryCasOutcome,
} from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import type {
  WorkspacePaneLayoutRestoreTransaction,
  WorkspacePaneLayoutRestoreTransactionOutcome,
} from '#/server/workspace-pane/workspace-pane-layout-restore-transaction.ts'
import { normalizeGlobalShortcut } from '#/shared/accelerator.ts'
import { isColorTheme, type ColorTheme } from '#/shared/color-theme.ts'
import {
  DEFAULT_COLOR_THEME,
  DEFAULT_FETCH_INTERVAL_SEC,
  DEFAULT_LANG_PREF,
  DEFAULT_THEME_PREF,
  MAX_RECENT_WORKSPACES,
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
  recentWorkspaces: WorkspaceSessionEntry[]
  workspaceSettings: WorkspaceSettingsEntry[]
}

export type UserSettingsPatch = Partial<UserSettings>

let settingsData: UserSettingsData | null = null
let settingsLoadPromise: Promise<UserSettingsData> | null = null
let settingsMutationPromise: Promise<void> = Promise.resolve()
const listeners = new Set<FetchIntervalListener>()

function notifyFetchIntervalListeners(sec: number): void {
  for (const listener of listeners) listener(sec)
}

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

function dedupeWorkspaceEntries(entries: WorkspaceSessionEntry[]): WorkspaceSessionEntry[] {
  const seen = new Set<string>()
  const normalized: WorkspaceSessionEntry[] = []
  for (const entry of entries) {
    const id = workspaceSessionEntryId(entry)
    if (seen.has(id)) continue
    seen.add(id)
    normalized.push(entry)
  }
  return normalized
}

function defaultWorkspace(): ServerWorkspaceState {
  return defaultServerWorkspaceState()
}

function normalizeWorkspacePaneTabsByTargetByWorkspace(
  value: unknown,
): Record<string, Record<string, WorkspacePaneStaticTabEntry[]>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalized: Record<string, Record<string, WorkspacePaneStaticTabEntry[]>> = {}
  for (const [workspaceId, rawByTarget] of Object.entries(value)) {
    const safeWorkspaceId = toSafeWorkspaceLocator(workspaceId)
    if (!safeWorkspaceId || !rawByTarget || typeof rawByTarget !== 'object' || Array.isArray(rawByTarget)) continue
    const byTarget: Record<string, WorkspacePaneStaticTabEntry[]> = {}
    for (const [targetKey, rawTabs] of Object.entries(rawByTarget)) {
      const target = safeRestorableWorkspacePaneTarget(safeWorkspaceId, targetKey)
      if (!target || !Array.isArray(rawTabs)) continue
      const tabs: WorkspacePaneStaticTabEntry[] = []
      const seen = new Set<string>()
      for (const raw of rawTabs) {
        const entry = workspacePaneTabEntryFromUnknown(raw)
        if (!entry || isWorkspacePaneRuntimeTabEntry(entry)) continue
        if (target.kind === 'git-branch' && workspacePaneTabRequiresWorktree(entry.type)) continue
        const identity = workspacePaneTabEntryIdentity(entry)
        if (seen.has(identity)) continue
        seen.add(identity)
        tabs.push(entry)
      }
      byTarget[targetKey] = tabs
    }
    if (Object.keys(byTarget).length > 0) normalized[safeWorkspaceId] = byTarget
  }
  return normalized
}

function safeRestorableWorkspacePaneTarget(workspaceId: string, targetKey: string): RestorableWorkspacePaneTarget | null {
  const parsed = parseRestorableWorkspacePaneTargetKey(targetKey)
  if (!parsed) return null
  if (parsed.kind === 'git-branch') return isSafeBranchName(parsed.branch) ? parsed : null
  if (parsed.kind === 'git-worktree' && !workspacePaneTabsTargetFromRestorable(workspaceId, parsed)) return null
  return parsed
}

function normalizeWorkspace(value: unknown): ServerWorkspaceState {
  if (!value || typeof value !== 'object') return defaultWorkspace()
  const partial = value as Partial<ServerWorkspaceState>
  return {
    openWorkspaceEntries: normalizeWorkspaceEntries(partial.openWorkspaceEntries),
    workspacePaneTabsByTargetByWorkspace: normalizeWorkspacePaneTabsByTargetByWorkspace(
      partial.workspacePaneTabsByTargetByWorkspace,
    ),
  }
}

function normalizeRecentWorkspaces(value: unknown): WorkspaceSessionEntry[] {
  return normalizeWorkspaceEntries(value).slice(0, MAX_RECENT_WORKSPACES)
}

function normalizeWorkspaceEntries(value: unknown): WorkspaceSessionEntry[] {
  if (!Array.isArray(value)) return []
  return dedupeWorkspaceEntries(
    value.map(toSafeWorkspaceSessionEntry).filter((entry): entry is WorkspaceSessionEntry => entry !== null),
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

interface RawWorkspaceSettingsEntry {
  workspaceId?: unknown
  repoId?: unknown
  worktreeBootstrapTrust?: unknown
  workspaceExternalAppRecent?: unknown
}

function normalizeWorkspaceSettings(value: unknown, identityField: 'workspaceId' | 'repoId'): WorkspaceSettingsEntry[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const normalized: WorkspaceSettingsEntry[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as RawWorkspaceSettingsEntry
    const workspaceId = toSafeWorkspaceLocator(raw[identityField])
    if (!workspaceId || seen.has(workspaceId)) continue
    seen.add(workspaceId)
    const entry: WorkspaceSettingsEntry = { workspaceId }
    const worktreeBootstrapTrust = normalizeWorktreeBootstrapTrust(raw.worktreeBootstrapTrust)
    if (worktreeBootstrapTrust) entry.worktreeBootstrapTrust = worktreeBootstrapTrust
    const workspaceExternalAppRecent = normalizeWorkspaceExternalAppRecent(raw.workspaceExternalAppRecent)
    if (workspaceExternalAppRecent) entry.workspaceExternalAppRecent = workspaceExternalAppRecent
    normalized.push(entry)
  }
  return normalized
}

function cloneWorkspaceSettings(workspaceSettings: readonly WorkspaceSettingsEntry[]): WorkspaceSettingsEntry[] {
  return workspaceSettings.map((entry) => ({
    workspaceId: entry.workspaceId,
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
  const parsed = raw as Partial<UserSettingsData> & { repoSettings?: unknown }
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
    recentWorkspaces: normalizeRecentWorkspaces(parsed.recentWorkspaces),
    workspaceSettings:
      parsed.workspaceSettings !== undefined
        ? normalizeWorkspaceSettings(parsed.workspaceSettings, 'workspaceId')
        : normalizeWorkspaceSettings(parsed.repoSettings, 'repoId'),
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
        recentWorkspaces: [],
        workspaceSettings: [],
      }
      await writeUserSettingsFile(data)
    }
    settingsData = data
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
 * Apply a patch to the `WorkspaceSettingsEntry` matching `workspaceId`, creating the
 * entry if it doesn't exist. The patch receives the current entry (or
 * `undefined`) and returns the new entry, or `null` to skip the update
 * entirely (used by callers that want to no-op on unchanged values).
 * Returns the updated list, or `null` when the patch is a no-op.
 */
function updateWorkspaceSettingsEntry(
  workspaceSettings: readonly WorkspaceSettingsEntry[],
  workspaceId: WorkspaceId,
  patch: (existing: WorkspaceSettingsEntry | undefined) => WorkspaceSettingsEntry | null,
): WorkspaceSettingsEntry[] | null {
  const existingIndex = workspaceSettings.findIndex((entry) => entry.workspaceId === workspaceId)
  const existing = existingIndex >= 0 ? workspaceSettings[existingIndex] : undefined
  const next = patch(existing)
  if (next === null) return null
  if (existingIndex >= 0) {
    return workspaceSettings.map((entry, index) => (index === existingIndex ? next : entry))
  }
  return [...workspaceSettings, next]
}

export async function getServerFetchIntervalSec(): Promise<number> {
  return (await loadUserSettings()).fetchIntervalSec
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
      afterCommit: changed ? () => notifyFetchIntervalListeners(next) : undefined,
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
    const fetchIntervalChanged = data.fetchIntervalSec !== nextFetchIntervalSec
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
      afterCommit: fetchIntervalChanged ? () => notifyFetchIntervalListeners(nextFetchIntervalSec) : undefined,
    }
  })
}

export async function getServerWorkspaceState(): Promise<ServerWorkspaceState> {
  return cloneWorkspace((await loadUserSettings()).workspace)
}

export async function addServerWorkspaceEntry(entry: WorkspaceSessionEntry): Promise<ServerWorkspaceState> {
  return await mutateUserSettings(async (data) => {
    const id = workspaceSessionEntryId(entry)
    const existingIndex = data.workspace.openWorkspaceEntries.findIndex(
      (candidate) => workspaceSessionEntryId(candidate) === id,
    )
    const openWorkspaceEntries = [...data.workspace.openWorkspaceEntries]
    if (existingIndex === -1) openWorkspaceEntries.push(entry)
    else openWorkspaceEntries[existingIndex] = entry
    const workspace = { ...data.workspace, openWorkspaceEntries }
    return { next: { ...data, workspace }, result: cloneWorkspace(workspace) }
  })
}

export async function removeServerWorkspaceEntry(workspaceId: WorkspaceId): Promise<ServerWorkspaceState> {
  return await mutateUserSettings(async (data) => {
    const openWorkspaceEntries = data.workspace.openWorkspaceEntries.filter(
      (entry) => workspaceSessionEntryId(entry) !== workspaceId,
    )
    if (openWorkspaceEntries.length === data.workspace.openWorkspaceEntries.length) {
      return unchangedUserSettings(data, cloneWorkspace(data.workspace))
    }
    const workspace = { ...data.workspace, openWorkspaceEntries }
    return { next: { ...data, workspace }, result: cloneWorkspace(workspace) }
  })
}

export type ServerWorkspaceMatchOutcome =
  { matched: true; workspace: ServerWorkspaceState } | { matched: false; latestWorkspace: ServerWorkspaceState }

export async function compareAndReplaceServerWorkspaceEntries(
  expected: WorkspaceSessionEntry[],
  replacement: WorkspaceSessionEntry[],
): Promise<ServerWorkspaceMatchOutcome> {
  return await mutateUserSettings<ServerWorkspaceMatchOutcome>(async (data) => {
    if (!sameWorkspaceEntries(data.workspace.openWorkspaceEntries, expected)) {
      return unchangedUserSettings(data, { matched: false, latestWorkspace: cloneWorkspace(data.workspace) })
    }
    if (sameWorkspaceEntries(expected, replacement)) {
      return unchangedUserSettings(data, { matched: true, workspace: cloneWorkspace(data.workspace) })
    }
    const workspace = { ...data.workspace, openWorkspaceEntries: replacement }
    return {
      next: { ...data, workspace },
      result: { matched: true, workspace: cloneWorkspace(workspace) },
    }
  })
}

export async function confirmServerWorkspaceEntry(
  expected: WorkspaceSessionEntry,
): Promise<ServerWorkspaceMatchOutcome> {
  return await mutateUserSettings<ServerWorkspaceMatchOutcome>(async (data) => {
    const current = data.workspace.openWorkspaceEntries.find(
      (entry) => workspaceSessionEntryId(entry) === workspaceSessionEntryId(expected),
    )
    return unchangedUserSettings(
      data,
      sameWorkspaceSessionEntry(current, expected)
        ? { matched: true, workspace: cloneWorkspace(data.workspace) }
        : { matched: false, latestWorkspace: cloneWorkspace(data.workspace) },
    )
  })
}

function sameWorkspaceEntries(a: WorkspaceSessionEntry[], b: WorkspaceSessionEntry[]): boolean {
  return a.length === b.length && a.every((entry, index) => sameWorkspaceSessionEntry(entry, b[index]))
}

function workspacePaneLayoutFromWorkspace(
  workspace: ServerWorkspaceState,
  repoRoot: string,
): WorkspacePaneDurableLayout {
  const entries: WorkspacePaneDurableLayout['entries'] = []
  for (const [targetKey, tabs] of Object.entries(workspace.workspacePaneTabsByTargetByWorkspace[repoRoot] ?? {})) {
    const target = parseRestorableWorkspacePaneTargetKey(targetKey)
    if (!target || !workspacePaneTabsTargetFromRestorable(repoRoot, target)) continue
    entries.push({ target, tabs })
  }
  return normalizeWorkspacePaneDurableLayout(repoRoot, { entries })
}

export const serverWorkspacePaneLayoutRepository: WorkspacePaneLayoutRepository = {
  async load(repoRoot) {
    const workspace = (await loadUserSettings()).workspace
    return { layout: workspacePaneLayoutFromWorkspace(workspace, repoRoot) }
  },

  async compareAndSwap(input) {
    return await compareAndSwapWorkspacePaneLayout(input)
  },
}

export const serverWorkspacePaneLayoutRestoreTransaction: WorkspacePaneLayoutRestoreTransaction = {
  async validateMembershipAndLoad(input) {
    return await mutateUserSettings<WorkspacePaneLayoutRestoreTransactionOutcome>(async (data) => {
      const currentLayout = workspacePaneLayoutFromWorkspace(data.workspace, input.repoRoot)
      const snapshot = { layout: currentLayout }
      const currentRepoEntry = data.workspace.openWorkspaceEntries.find(
        (entry) => workspaceSessionEntryId(entry) === input.repoRoot,
      )
      if (!sameWorkspaceSessionEntry(currentRepoEntry, input.expectedRepoEntry)) {
        return unchangedUserSettings(data, { kind: 'membership-conflict', snapshot })
      }
      return unchangedUserSettings(data, { kind: 'accepted' as const, snapshot })
    })
  },
}

async function compareAndSwapWorkspacePaneLayout(
  input: WorkspacePaneLayoutRepositoryCasInput,
): Promise<WorkspacePaneLayoutRepositoryCasOutcome> {
  return await mutateWorkspacePaneSettings<WorkspacePaneLayoutRepositoryCasOutcome>(
    async (data) => {
      const currentLayout = workspacePaneLayoutFromWorkspace(data.workspace, input.repoRoot)
      const snapshot = { layout: currentLayout }
      if (!workspacePaneDurableLayoutsEqual(input.repoRoot, currentLayout, input.expected)) {
        return unchangedUserSettings(data, { kind: 'conflict', snapshot })
      }
      return workspacePaneLayoutMutation(data, input.repoRoot, currentLayout, input.replacement)
    },
    (error) => ({ kind: 'write-failure', error }),
  )
}

async function mutateWorkspacePaneSettings<T>(
  mutation: (data: UserSettingsData) => Promise<UserSettingsMutation<T>> | UserSettingsMutation<T>,
  onWriteFailure: (error: SettingsPersistenceWriteError, current: UserSettingsData) => T,
): Promise<T> {
  let writeBase: UserSettingsData | null = null
  try {
    return await mutateUserSettings(async (data) => {
      const plan = await mutation(data)
      if (plan.changed !== false) writeBase = data
      return plan
    })
  } catch (error) {
    if (!(error instanceof SettingsPersistenceWriteError) || !writeBase) throw error
    return onWriteFailure(error, writeBase)
  }
}

function workspacePaneLayoutMutation(
  data: UserSettingsData,
  repoRoot: string,
  currentLayout: WorkspacePaneDurableLayout,
  requestedLayout: WorkspacePaneDurableLayout,
): UserSettingsMutation<WorkspacePaneLayoutRepositoryCasOutcome> {
  const snapshot = { layout: currentLayout }
  const replacement = normalizeWorkspacePaneDurableLayout(repoRoot, requestedLayout)
  if (workspacePaneDurableLayoutsEqual(repoRoot, currentLayout, replacement)) {
    return unchangedUserSettings(data, { kind: 'accepted', snapshot, changed: false })
  }
  const byTarget = Object.fromEntries(
    replacement.entries.map((entry) => [restorableWorkspacePaneTargetKey(entry.target), entry.tabs] as const),
  )
  const workspacePaneTabsByTargetByWorkspace =
    Object.keys(byTarget).length === 0
      ? recordWithoutKey(data.workspace.workspacePaneTabsByTargetByWorkspace, repoRoot)
      : { ...data.workspace.workspacePaneTabsByTargetByWorkspace, [repoRoot]: byTarget }
  const workspace = normalizeWorkspace({ ...data.workspace, workspacePaneTabsByTargetByWorkspace })
  return {
    next: { ...data, workspace },
    result: {
      kind: 'accepted',
      snapshot: { layout: workspacePaneLayoutFromWorkspace(workspace, repoRoot) },
      changed: true,
    },
  }
}

export async function getServerRecentWorkspaces(): Promise<WorkspaceSessionEntry[]> {
  return [...(await loadUserSettings()).recentWorkspaces]
}

export async function getServerWorkspaceSettings(): Promise<WorkspaceSettingsEntry[]> {
  return cloneWorkspaceSettings((await loadUserSettings()).workspaceSettings)
}

export async function trustServerWorkspaceWorktreeBootstrapConfig(input: {
  workspaceId: WorkspaceId
  configHash: string
}): Promise<WorkspaceSettingsEntry[]> {
  return await mutateUserSettings(async (data) => {
    if (!isWorktreeBootstrapConfigHash(input.configHash)) {
      return unchangedUserSettings(data, cloneWorkspaceSettings(data.workspaceSettings))
    }
    const worktreeBootstrapTrust: WorktreeBootstrapTrust = {
      configHash: input.configHash,
      trustedAt: new Date().toISOString(),
    }
    const workspaceSettings = updateWorkspaceSettingsEntry(data.workspaceSettings, input.workspaceId, (existing) => ({
      workspaceId: input.workspaceId,
      ...existing,
      worktreeBootstrapTrust,
    }))
    const nextData = workspaceSettings ? { ...data, workspaceSettings } : data
    return {
      next: nextData,
      result: cloneWorkspaceSettings(nextData.workspaceSettings),
      changed: workspaceSettings !== null,
    }
  })
}

export async function untrustServerWorkspaceWorktreeBootstrapConfig(input: {
  workspaceId: WorkspaceId
  configHash: string
}): Promise<boolean> {
  return await mutateUserSettings(async (data) => {
    if (!isWorktreeBootstrapConfigHash(input.configHash)) return unchangedUserSettings(data, false)
    const existingIndex = data.workspaceSettings.findIndex((entry) => entry.workspaceId === input.workspaceId)
    if (existingIndex < 0) return unchangedUserSettings(data, false)
    const existing = data.workspaceSettings[existingIndex]
    if (existing.worktreeBootstrapTrust?.configHash !== input.configHash) return unchangedUserSettings(data, false)

    const nextEntry: WorkspaceSettingsEntry = { ...existing }
    delete nextEntry.worktreeBootstrapTrust
    if (nextEntry.workspaceExternalAppRecent) {
      const workspaceSettings = data.workspaceSettings.map((entry, index) =>
        index === existingIndex ? nextEntry : entry,
      )
      return { next: { ...data, workspaceSettings }, result: true }
    } else {
      const workspaceSettings = data.workspaceSettings.filter((_, index) => index !== existingIndex)
      return { next: { ...data, workspaceSettings }, result: true }
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
export async function setServerWorkspaceExternalAppRecent(input: {
  workspaceId: WorkspaceId
  worktreePath: string | null
  itemId: string
}): Promise<WorkspaceSettingsEntry[]> {
  return await mutateUserSettings(async (data) => {
    // Validate the worktree key: `null`/`undefined` collapses to "" (bare
    // repo); otherwise the path must be a normalized absolute path with
    // no NULs. `toSafeSessionPath` encodes the same validation used
    // elsewhere in the codebase, so the rules can't drift.
    const isBareRepoScope = input.worktreePath === null || input.worktreePath === undefined
    const safeWorktreePath = isBareRepoScope ? null : toSafeSessionPath(input.worktreePath)
    if ((!isBareRepoScope && safeWorktreePath === null) || !isKnownWorkspaceExternalAppItemId(input.itemId)) {
      return unchangedUserSettings(data, cloneWorkspaceSettings(data.workspaceSettings))
    }
    const worktreeKey = workspaceExternalAppRecentKey(safeWorktreePath)
    // No-op when the value hasn't changed — keeps a no-op click from
    // triggering a full user-settings.json rewrite.
    const workspaceSettings = updateWorkspaceSettingsEntry(data.workspaceSettings, input.workspaceId, (existing) => {
      const existingByWorktree = existing?.workspaceExternalAppRecent?.byWorktree ?? {}
      if (existingByWorktree[worktreeKey] === input.itemId) return null
      return {
        workspaceId: input.workspaceId,
        ...existing,
        workspaceExternalAppRecent: { byWorktree: { ...existingByWorktree, [worktreeKey]: input.itemId } },
      }
    })
    const nextData = workspaceSettings ? { ...data, workspaceSettings } : data
    return {
      next: nextData,
      result: cloneWorkspaceSettings(nextData.workspaceSettings),
      changed: workspaceSettings !== null,
    }
  })
}

/**
 * Prune workspace settings that are scoped to a worktree path after that worktree
 * has been removed. Workspace-level settings, such as bootstrap trust, stay intact.
 * Returns true when the settings file changed.
 */
export async function pruneServerWorkspaceSettingsForRemovedWorktree(input: {
  workspaceId: WorkspaceId
  worktreePath: string
}): Promise<boolean> {
  return await mutateUserSettings(async (data) => {
    const safeWorktreePath = toSafeSessionPath(input.worktreePath)
    if (safeWorktreePath === null) return unchangedUserSettings(data, false)
    const worktreeKey = workspaceExternalAppRecentKey(safeWorktreePath)
    const existingIndex = data.workspaceSettings.findIndex((entry) => entry.workspaceId === input.workspaceId)
    if (existingIndex < 0) return unchangedUserSettings(data, false)
    const existing = data.workspaceSettings[existingIndex]
    const existingByWorktree = existing.workspaceExternalAppRecent?.byWorktree
    if (!existingByWorktree || !(worktreeKey in existingByWorktree)) return unchangedUserSettings(data, false)

    const nextByWorktree = { ...existingByWorktree }
    delete nextByWorktree[worktreeKey]
    const nextEntry: WorkspaceSettingsEntry = { ...existing }
    if (Object.keys(nextByWorktree).length > 0) {
      nextEntry.workspaceExternalAppRecent = { byWorktree: nextByWorktree }
    } else {
      delete nextEntry.workspaceExternalAppRecent
    }

    const workspaceSettings =
      nextEntry.worktreeBootstrapTrust || nextEntry.workspaceExternalAppRecent
        ? data.workspaceSettings.map((entry, index) => (index === existingIndex ? nextEntry : entry))
        : data.workspaceSettings.filter((_, index) => index !== existingIndex)
    return { next: { ...data, workspaceSettings }, result: true }
  })
}

export async function addServerRecentWorkspace(workspace: WorkspaceSessionEntry): Promise<WorkspaceSessionEntry[]> {
  return await mutateUserSettings(async (data) => {
    const safeWorkspace = toSafeWorkspaceSessionEntry(workspace)
    if (!safeWorkspace) return unchangedUserSettings(data, [...data.recentWorkspaces])
    const safeId = workspaceSessionEntryId(safeWorkspace)
    const recentWorkspaces = [
      safeWorkspace,
      ...data.recentWorkspaces.filter((entry) => workspaceSessionEntryId(entry) !== safeId),
    ].slice(0, MAX_RECENT_WORKSPACES)
    return { next: { ...data, recentWorkspaces }, result: [...recentWorkspaces] }
  })
}

export async function clearServerRecentWorkspaces(): Promise<void> {
  await mutateUserSettings(async (data) => {
    if (data.recentWorkspaces.length === 0) return { next: data, result: undefined, changed: false }
    return { next: { ...data, recentWorkspaces: [] }, result: undefined }
  })
}

export function resetServerSettingsSourceForTests(): void {
  settingsData = null
  settingsLoadPromise = null
  settingsMutationPromise = Promise.resolve()
  listeners.clear()
  resetUserSettingsPersistenceForTests()
}
