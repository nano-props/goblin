import { isDeepStrictEqual } from 'node:util'
import { isSafeBranchName } from '#/shared/refnames.ts'
import type { LangPref, ServerWorkspaceState, ThemePref } from '#/shared/api-types.ts'
import {
  normalizeWorkspaceSessionEntry,
  workspaceSessionEntryId,
  type WorkspaceSessionEntry,
} from '#/shared/remote-workspace.ts'
import {
  isKnownWorkspaceExternalAppItemId,
  isWorktreeBootstrapConfigHash,
  parseWorkspaceExternalAppRecentKey,
  workspaceExternalAppRecentKey,
  type WorkspaceSettingsEntry,
  type WorkspaceExternalAppRecent,
  type WorktreeBootstrapTrust,
} from '#/shared/workspace-settings.ts'
import {
  isWorkspacePaneRuntimeTabEntry,
  type WorkspacePaneStaticTabEntry,
  workspacePaneTabEntryFromUnknown,
  workspacePaneTabEntryIdentity,
  workspacePaneTabRequiresWorktree,
} from '#/shared/workspace-pane.ts'
import {
  parseRestorableWorkspacePaneTargetKey,
  workspacePaneTabsTargetFromRestorable,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { RestorableWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import { toSafeCanonicalWorkspaceId, type WorkspaceId } from '#/shared/workspace-locator.ts'
import { parseAllowedGlobalShortcut } from '#/shared/accelerator.ts'
import { isColorTheme, type ColorTheme } from '#/shared/color-theme.ts'
import { MAX_RECENT_WORKSPACES, defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'

export interface UserSettingsData {
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

export function isFetchInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= 3600
}

export function isThemePref(value: unknown): value is ThemePref {
  return value === 'auto' || value === 'light' || value === 'dark'
}

export function isLangPref(value: unknown): value is LangPref {
  return value === 'auto' || value === 'en' || value === 'zh' || value === 'ko' || value === 'ja'
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
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

export function normalizeWorkspace(value: unknown): ServerWorkspaceState {
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

export function currentSettingsData(raw: Record<string, unknown>): UserSettingsData | null {
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
    fetchIntervalSec: raw.fetchIntervalSec === 0 ? 0 : raw.fetchIntervalSec,
    terminalNotificationsEnabled: raw.terminalNotificationsEnabled,
    shortcutsDisabled: raw.shortcutsDisabled,
    globalShortcutDisabled: raw.globalShortcutDisabled,
    globalShortcut,
    lanEnabled: raw.lanEnabled,
    workspace: normalizeWorkspace(raw.workspace),
    recentWorkspaces: normalizeRecentWorkspaces(raw.recentWorkspaces),
    workspaceSettings: normalizeWorkspaceSettings(raw.workspaceSettings),
  }
  const recognizedRaw = {
    lang: raw.lang,
    theme: raw.theme,
    colorTheme: raw.colorTheme,
    fetchIntervalSec: raw.fetchIntervalSec === 0 ? 0 : raw.fetchIntervalSec,
    terminalNotificationsEnabled: raw.terminalNotificationsEnabled,
    shortcutsDisabled: raw.shortcutsDisabled,
    globalShortcutDisabled: raw.globalShortcutDisabled,
    globalShortcut: raw.globalShortcut,
    lanEnabled: raw.lanEnabled,
    workspace: raw.workspace,
    recentWorkspaces: raw.recentWorkspaces,
    workspaceSettings: raw.workspaceSettings,
  }
  return isDeepStrictEqual(decoded, recognizedRaw) ? decoded : null
}
