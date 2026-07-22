import { isDeepStrictEqual } from 'node:util'
import { isSafeBranchName } from '#/shared/refnames.ts'
import {
  readUserSettingsJson,
  resetUserSettingsPersistenceForTests,
  SettingsPersistenceWriteError,
  writeUserSettingsJson,
} from '#/server/modules/settings-persistence.ts'
import type { LangPref, ServerWorkspaceState, UserSettings, ThemePref } from '#/shared/api-types.ts'
import {
  normalizeWorkspaceSessionEntry,
  workspaceSessionEntryId,
  sameWorkspaceSessionEntry,
  type WorkspaceSessionEntry,
} from '#/shared/remote-workspace.ts'
import { recordWithoutKey } from '#/shared/record.ts'
import {
  isKnownWorkspaceExternalAppItemId,
  isWorktreeBootstrapConfigHash,
  parseWorkspaceExternalAppRecentKey,
  workspaceExternalAppTargetForWorktree,
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
import { toSafeCanonicalWorkspaceId, type WorkspaceId } from '#/shared/workspace-locator.ts'
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
import { parseAllowedGlobalShortcut } from '#/shared/accelerator.ts'
import { isColorTheme, type ColorTheme } from '#/shared/color-theme.ts'
import { closeWorkspaceRuntimesForDurableRemoval } from '#/server/modules/workspace-runtimes.ts'
import {
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

const USER_SETTINGS_VERSION = 1
type UserSettingsReadOutcome =
  | { kind: 'missing' }
  | { kind: 'current'; data: UserSettingsData }
  | { kind: 'corrupt'; error: Error }
  | { kind: 'unsupported'; error: Error }

export type UserSettingsPatch = Partial<UserSettings>

let settingsData: UserSettingsData | null = null
let settingsLoadPromise: Promise<UserSettingsData> | null = null
let settingsMutationPromise: Promise<void> = Promise.resolve()
const listeners = new Set<FetchIntervalListener>()

function notifyFetchIntervalListeners(sec: number): void {
  for (const listener of listeners) listener(sec)
}

function isFetchInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= 3600
}

function isThemePref(value: unknown): value is ThemePref {
  return value === 'auto' || value === 'light' || value === 'dark'
}

function isLangPref(value: unknown): value is LangPref {
  return value === 'auto' || value === 'en' || value === 'zh' || value === 'ko' || value === 'ja'
}

function requireCommandValue<T>(value: unknown, valid: (candidate: unknown) => candidate is T, name: string): T {
  if (!valid(value)) throw new TypeError(`invalid ${name}`)
  return value
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
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
    const safeWorkspaceId = toSafeCanonicalWorkspaceId(workspaceId)
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

function safeRestorableWorkspacePaneTarget(
  workspaceId: WorkspaceId,
  targetKey: string,
): RestorableWorkspacePaneTarget | null {
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
    value.map(normalizeWorkspaceSessionEntry).filter((entry): entry is WorkspaceSessionEntry => entry !== null),
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

function normalizeWorkspaceExternalAppRecent(
  workspaceId: WorkspaceId,
  value: unknown,
): WorkspaceExternalAppRecent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Partial<WorkspaceExternalAppRecent>
  if (!raw.byTarget || typeof raw.byTarget !== 'object' || Array.isArray(raw.byTarget)) return undefined
  const byTarget: Record<string, string> = {}
  for (const [targetKey, itemId] of Object.entries(raw.byTarget)) {
    const target = parseWorkspaceExternalAppRecentKey(workspaceId, targetKey)
    if (!target) continue
    if (!isKnownWorkspaceExternalAppItemId(itemId)) continue
    byTarget[workspaceExternalAppRecentKey(target)] = itemId
  }
  if (Object.keys(byTarget).length === 0) return undefined
  return { byTarget }
}

interface RawWorkspaceSettingsEntry {
  workspaceId?: unknown
  worktreeBootstrapTrust?: unknown
  workspaceExternalAppRecent?: unknown
}

function normalizeWorkspaceSettings(value: unknown): WorkspaceSettingsEntry[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const normalized: WorkspaceSettingsEntry[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as RawWorkspaceSettingsEntry
    const workspaceId = toSafeCanonicalWorkspaceId(raw.workspaceId)
    if (!workspaceId || seen.has(workspaceId)) continue
    seen.add(workspaceId)
    const entry: WorkspaceSettingsEntry = { workspaceId }
    const worktreeBootstrapTrust = normalizeWorktreeBootstrapTrust(raw.worktreeBootstrapTrust)
    if (worktreeBootstrapTrust) entry.worktreeBootstrapTrust = worktreeBootstrapTrust
    const workspaceExternalAppRecent = normalizeWorkspaceExternalAppRecent(workspaceId, raw.workspaceExternalAppRecent)
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
      ? { workspaceExternalAppRecent: { byTarget: { ...entry.workspaceExternalAppRecent.byTarget } } }
      : {}),
  }))
}

function cloneWorkspace(workspace: ServerWorkspaceState): ServerWorkspaceState {
  return normalizeWorkspace(workspace)
}

function currentSettingsData(raw: Record<string, unknown>): UserSettingsData | null {
  if (
    !isLangPref(raw.lang) ||
    !isThemePref(raw.theme) ||
    !isColorTheme(raw.colorTheme) ||
    !isFetchInterval(raw.fetchIntervalSec) ||
    !isBoolean(raw.terminalNotificationsEnabled) ||
    !isBoolean(raw.shortcutsDisabled) ||
    !isBoolean(raw.globalShortcutDisabled) ||
    !isBoolean(raw.lanEnabled)
  )
    return null
  const globalShortcut = parseAllowedGlobalShortcut(raw.globalShortcut)
  if (!globalShortcut || globalShortcut !== raw.globalShortcut) return null
  const decoded: UserSettingsData = {
    lang: raw.lang,
    theme: raw.theme,
    colorTheme: raw.colorTheme,
    fetchIntervalSec: raw.fetchIntervalSec,
    terminalNotificationsEnabled: raw.terminalNotificationsEnabled,
    shortcutsDisabled: raw.shortcutsDisabled,
    globalShortcutDisabled: raw.globalShortcutDisabled,
    globalShortcut,
    lanEnabled: raw.lanEnabled,
    workspace: normalizeWorkspace(raw.workspace),
    recentWorkspaces: normalizeRecentWorkspaces(raw.recentWorkspaces),
    workspaceSettings: normalizeWorkspaceSettings(raw.workspaceSettings),
  }
  return isDeepStrictEqual({ version: USER_SETTINGS_VERSION, ...decoded }, raw) ? decoded : null
}

async function readUserSettingsFile(): Promise<UserSettingsReadOutcome> {
  const persisted = await readUserSettingsJson()
  if (persisted.kind === 'missing') return { kind: 'missing' }
  const raw = persisted.value
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'corrupt', error: new Error('settings root must be an object') }
  }
  const version = (raw as Record<string, unknown>).version
  if (version !== USER_SETTINGS_VERSION) {
    return { kind: 'unsupported', error: new Error(`unsupported settings version: ${String(version)}`) }
  }
  const current = currentSettingsData(raw as Record<string, unknown>)
  if (!current) {
    return { kind: 'corrupt', error: new Error('invalid current settings shape') }
  }
  return { kind: 'current', data: current }
}

async function writeUserSettingsFile(data: UserSettingsData): Promise<void> {
  await writeUserSettingsJson({ version: USER_SETTINGS_VERSION, ...data })
}

async function loadUserSettings(): Promise<UserSettingsData> {
  if (settingsData) return settingsData
  settingsLoadPromise ??= (async () => {
    const persisted = await readUserSettingsFile()
    if (persisted.kind === 'unsupported') throw persisted.error
    let data: UserSettingsData
    if (persisted.kind === 'current') {
      data = persisted.data
    } else {
      if (persisted.kind === 'corrupt') {
        throw persisted.error
      }
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
        invalidateRemovedWorkspaceRuntimes(current.workspace, commit.next.workspace)
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

function invalidateRemovedWorkspaceRuntimes(before: ServerWorkspaceState, after: ServerWorkspaceState): void {
  const retainedWorkspaceIds = new Set(after.openWorkspaceEntries.map(workspaceSessionEntryId))
  for (const entry of before.openWorkspaceEntries) {
    const workspaceId = workspaceSessionEntryId(entry)
    if (!retainedWorkspaceIds.has(workspaceId)) closeWorkspaceRuntimesForDurableRemoval(workspaceId)
  }
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
  const next = requireCommandValue(sec, isFetchInterval, 'fetch interval')
  return await mutateUserSettings(async (data) => {
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
  const nextLang = patch.lang === undefined ? undefined : requireCommandValue(patch.lang, isLangPref, 'language')
  const nextTheme = patch.theme === undefined ? undefined : requireCommandValue(patch.theme, isThemePref, 'theme')
  const nextColorTheme =
    patch.colorTheme === undefined ? undefined : requireCommandValue(patch.colorTheme, isColorTheme, 'color theme')
  const nextFetchIntervalSec =
    patch.fetchIntervalSec === undefined
      ? undefined
      : requireCommandValue(patch.fetchIntervalSec, isFetchInterval, 'fetch interval')
  const nextTerminalNotificationsEnabled =
    patch.terminalNotificationsEnabled === undefined
      ? undefined
      : requireCommandValue(patch.terminalNotificationsEnabled, isBoolean, 'terminal notifications setting')
  const nextShortcutsDisabled =
    patch.shortcutsDisabled === undefined
      ? undefined
      : requireCommandValue(patch.shortcutsDisabled, isBoolean, 'shortcuts setting')
  const nextGlobalShortcutDisabled =
    patch.globalShortcutDisabled === undefined
      ? undefined
      : requireCommandValue(patch.globalShortcutDisabled, isBoolean, 'global shortcut disabled setting')
  const nextGlobalShortcut =
    patch.globalShortcut === undefined ? undefined : parseAllowedGlobalShortcut(patch.globalShortcut)
  if (patch.globalShortcut !== undefined && nextGlobalShortcut === null) throw new TypeError('invalid global shortcut')
  const nextLanEnabled =
    patch.lanEnabled === undefined ? undefined : requireCommandValue(patch.lanEnabled, isBoolean, 'LAN setting')
  return await mutateUserSettings(async (data) => {
    const resolvedLang = nextLang ?? data.lang
    const resolvedTheme = nextTheme ?? data.theme
    const resolvedColorTheme = nextColorTheme ?? data.colorTheme
    const resolvedFetchIntervalSec = nextFetchIntervalSec ?? data.fetchIntervalSec
    const resolvedTerminalNotificationsEnabled = nextTerminalNotificationsEnabled ?? data.terminalNotificationsEnabled
    const resolvedShortcutsDisabled = nextShortcutsDisabled ?? data.shortcutsDisabled
    const resolvedGlobalShortcutDisabled = nextGlobalShortcutDisabled ?? data.globalShortcutDisabled
    const resolvedGlobalShortcut = nextGlobalShortcut ?? data.globalShortcut
    const resolvedLanEnabled = nextLanEnabled ?? data.lanEnabled
    const fetchIntervalChanged = data.fetchIntervalSec !== resolvedFetchIntervalSec
    const changed =
      data.lang !== resolvedLang ||
      data.theme !== resolvedTheme ||
      data.colorTheme !== resolvedColorTheme ||
      data.fetchIntervalSec !== resolvedFetchIntervalSec ||
      data.terminalNotificationsEnabled !== resolvedTerminalNotificationsEnabled ||
      data.shortcutsDisabled !== resolvedShortcutsDisabled ||
      data.globalShortcutDisabled !== resolvedGlobalShortcutDisabled ||
      data.globalShortcut !== resolvedGlobalShortcut ||
      data.lanEnabled !== resolvedLanEnabled
    const nextData: UserSettingsData = changed
      ? {
          ...data,
          lang: resolvedLang,
          theme: resolvedTheme,
          colorTheme: resolvedColorTheme,
          fetchIntervalSec: resolvedFetchIntervalSec,
          terminalNotificationsEnabled: resolvedTerminalNotificationsEnabled,
          shortcutsDisabled: resolvedShortcutsDisabled,
          globalShortcutDisabled: resolvedGlobalShortcutDisabled,
          globalShortcut: resolvedGlobalShortcut,
          lanEnabled: resolvedLanEnabled,
        }
      : data
    return {
      next: nextData,
      result: userSettingsFromData(nextData),
      changed,
      afterCommit: fetchIntervalChanged ? () => notifyFetchIntervalListeners(resolvedFetchIntervalSec) : undefined,
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
  workspaceId: WorkspaceId,
): WorkspacePaneDurableLayout {
  const entries: WorkspacePaneDurableLayout['entries'] = []
  for (const [targetKey, tabs] of Object.entries(workspace.workspacePaneTabsByTargetByWorkspace[workspaceId] ?? {})) {
    const target = parseRestorableWorkspacePaneTargetKey(targetKey)
    if (!target || !workspacePaneTabsTargetFromRestorable(workspaceId, target)) continue
    entries.push({ target, tabs })
  }
  return normalizeWorkspacePaneDurableLayout(workspaceId, { entries })
}

export const serverWorkspacePaneLayoutRepository: WorkspacePaneLayoutRepository = {
  async load(workspaceId) {
    const workspace = (await loadUserSettings()).workspace
    return { layout: workspacePaneLayoutFromWorkspace(workspace, workspaceId) }
  },

  async compareAndSwap(input) {
    return await compareAndSwapWorkspacePaneLayout(input)
  },
}

export const serverWorkspacePaneLayoutRestoreTransaction: WorkspacePaneLayoutRestoreTransaction = {
  async validateMembershipAndLoad(input) {
    return await mutateUserSettings<WorkspacePaneLayoutRestoreTransactionOutcome>(async (data) => {
      const currentLayout = workspacePaneLayoutFromWorkspace(data.workspace, input.workspaceId)
      const snapshot = { layout: currentLayout }
      const currentWorkspaceEntry = data.workspace.openWorkspaceEntries.find(
        (entry) => workspaceSessionEntryId(entry) === input.workspaceId,
      )
      if (!sameWorkspaceSessionEntry(currentWorkspaceEntry, input.expectedWorkspaceEntry)) {
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
      const currentLayout = workspacePaneLayoutFromWorkspace(data.workspace, input.workspaceId)
      const snapshot = { layout: currentLayout }
      if (!workspacePaneDurableLayoutsEqual(input.workspaceId, currentLayout, input.expected)) {
        return unchangedUserSettings(data, { kind: 'conflict', snapshot })
      }
      return workspacePaneLayoutMutation(data, input.workspaceId, currentLayout, input.replacement)
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
  workspaceId: WorkspaceId,
  currentLayout: WorkspacePaneDurableLayout,
  requestedLayout: WorkspacePaneDurableLayout,
): UserSettingsMutation<WorkspacePaneLayoutRepositoryCasOutcome> {
  const snapshot = { layout: currentLayout }
  const replacement = normalizeWorkspacePaneDurableLayout(workspaceId, requestedLayout)
  if (workspacePaneDurableLayoutsEqual(workspaceId, currentLayout, replacement)) {
    return unchangedUserSettings(data, { kind: 'accepted', snapshot, changed: false })
  }
  const byTarget = Object.fromEntries(
    replacement.entries.map((entry) => [restorableWorkspacePaneTargetKey(entry.target), entry.tabs] as const),
  )
  const workspacePaneTabsByTargetByWorkspace =
    Object.keys(byTarget).length === 0
      ? recordWithoutKey(data.workspace.workspacePaneTabsByTargetByWorkspace, workspaceId)
      : { ...data.workspace.workspacePaneTabsByTargetByWorkspace, [workspaceId]: byTarget }
  const workspace = normalizeWorkspace({ ...data.workspace, workspacePaneTabsByTargetByWorkspace })
  return {
    next: { ...data, workspace },
    result: {
      kind: 'accepted',
      snapshot: { layout: workspacePaneLayoutFromWorkspace(workspace, workspaceId) },
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
 * Record the most recently chosen external app for one canonical
 * Workspace filesystem target. No-op when the value is already current.
 */
export async function setServerWorkspaceExternalAppRecent(input: {
  workspaceId: WorkspaceId
  targetKey: string
  itemId: string
}): Promise<WorkspaceSettingsEntry[]> {
  const target = parseWorkspaceExternalAppRecentKey(input.workspaceId, input.targetKey)
  if (!target) throw new TypeError('invalid workspace external-app target')
  if (!isKnownWorkspaceExternalAppItemId(input.itemId)) throw new TypeError('invalid workspace external-app item')
  const targetKey = workspaceExternalAppRecentKey(target)
  return await mutateUserSettings(async (data) => {
    // No-op when the value hasn't changed — keeps a no-op click from
    // triggering a full user-settings.json rewrite.
    const workspaceSettings = updateWorkspaceSettingsEntry(data.workspaceSettings, input.workspaceId, (existing) => {
      const existingByTarget = existing?.workspaceExternalAppRecent?.byTarget ?? {}
      if (existingByTarget[targetKey] === input.itemId) return null
      return {
        workspaceId: input.workspaceId,
        ...existing,
        workspaceExternalAppRecent: { byTarget: { ...existingByTarget, [targetKey]: input.itemId } },
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
    const target = workspaceExternalAppTargetForWorktree(input.workspaceId, input.worktreePath)
    if (!target) return unchangedUserSettings(data, false)
    const targetKey = workspaceExternalAppRecentKey(target)
    const existingIndex = data.workspaceSettings.findIndex((entry) => entry.workspaceId === input.workspaceId)
    if (existingIndex < 0) return unchangedUserSettings(data, false)
    const existing = data.workspaceSettings[existingIndex]
    const existingByTarget = existing.workspaceExternalAppRecent?.byTarget
    if (!existingByTarget || !(targetKey in existingByTarget)) return unchangedUserSettings(data, false)

    const nextByTarget = { ...existingByTarget }
    delete nextByTarget[targetKey]
    const nextEntry: WorkspaceSettingsEntry = { ...existing }
    if (Object.keys(nextByTarget).length > 0) {
      nextEntry.workspaceExternalAppRecent = { byTarget: nextByTarget }
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
    const safeWorkspace = normalizeWorkspaceSessionEntry(workspace)
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
