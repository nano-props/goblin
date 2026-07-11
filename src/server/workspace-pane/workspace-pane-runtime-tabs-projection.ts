import {
  isWorkspacePaneRuntimeTabEntry,
  type WorkspacePaneRuntimeTabType,
  type WorkspacePaneTabEntry,
  workspacePaneRuntimeTabEntry,
  workspacePaneRuntimeTabSessionId,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'
import { workspacePaneTabEntryArraysEqual } from '#/server/workspace-pane/workspace-pane-tabs-operations.ts'

export interface WorkspacePaneRuntimeTabsProjectionEntry {
  branchName: string
  worktreePath: string | null
  tabs: readonly WorkspacePaneTabEntry[]
}

export interface WorkspacePaneRuntimeTabsProjectionReplacement {
  branchName: string
  worktreePath: string
  tabs: WorkspacePaneTabEntry[]
}

export interface CanonicalWorkspacePaneTabsProjectionEntry extends WorkspacePaneRuntimeTabsProjectionEntry {
  tabs: WorkspacePaneTabEntry[]
}

export interface WorkspacePaneRuntimeTabsProjectionSession {
  sessionId: string
  branch: string
}

export interface WorkspacePaneRuntimeTabsProviderSnapshot {
  type: WorkspacePaneRuntimeTabType
  revision: number
  liveSessions: readonly WorkspacePaneRuntimeTabsProviderSnapshotSession[]
}

export interface WorkspacePaneRuntimeTabsProviderSnapshotSession extends WorkspacePaneRuntimeTabsProjectionSession {
  worktreePath: string
}

const DEFAULT_WORKTREE_TABS: readonly WorkspacePaneTabEntry[] = [workspacePaneStaticTabEntry('status')]

export function projectWorkspaceRuntimeTabsForWorktree(input: {
  runtimeType: WorkspacePaneRuntimeTabType
  entries: readonly WorkspacePaneRuntimeTabsProjectionEntry[]
  worktreePath: string
  liveSessions: readonly WorkspacePaneRuntimeTabsProjectionSession[]
}): WorkspacePaneRuntimeTabsProjectionReplacement[] {
  const replacements: WorkspacePaneRuntimeTabsProjectionReplacement[] = []
  const liveSessionIds = input.liveSessions.map((session) => session.sessionId)
  for (const entry of input.entries) {
    if (entry.worktreePath !== input.worktreePath) continue
    const nextTabs = workspaceTabsWithoutStaleRuntimeEntries(entry.tabs, input.runtimeType, liveSessionIds)
    if (workspacePaneTabEntryArraysEqual(entry.tabs, nextTabs)) continue
    replacements.push({
      branchName: entry.branchName,
      worktreePath: input.worktreePath,
      tabs: nextTabs,
    })
  }

  const branchName =
    input.entries.find((entry) => entry.worktreePath === input.worktreePath)?.branchName ??
    input.liveSessions[0]?.branch ??
    null
  if (!branchName || input.liveSessions.length === 0) return replacements

  const currentTabs =
    replacements.find((replacement) => replacement.branchName === branchName)?.tabs ??
    input.entries.find((entry) => entry.worktreePath === input.worktreePath && entry.branchName === branchName)?.tabs ??
    DEFAULT_WORKTREE_TABS
  const existingSessionIds = new Set(
    currentTabs.flatMap((entry) =>
      isWorkspacePaneRuntimeTabEntry(entry) && entry.type === input.runtimeType
        ? [workspacePaneRuntimeTabSessionId(entry)]
        : [],
    ),
  )
  const missingSessionIds = input.liveSessions
    .map((session) => session.sessionId)
    .filter((sessionId) => !existingSessionIds.has(sessionId))
  if (missingSessionIds.length === 0) return replacements

  const nextTabs = [
    ...currentTabs,
    ...missingSessionIds.map((sessionId) => workspacePaneRuntimeTabEntry(input.runtimeType, sessionId)),
  ]
  const existingReplacementIndex = replacements.findIndex((replacement) => replacement.branchName === branchName)
  if (existingReplacementIndex === -1) {
    replacements.push({ branchName, worktreePath: input.worktreePath, tabs: nextTabs })
  } else {
    replacements[existingReplacementIndex] = {
      branchName,
      worktreePath: input.worktreePath,
      tabs: nextTabs,
    }
  }
  return replacements
}

export function canonicalWorkspaceRuntimeTabsForTarget(input: {
  entry: WorkspacePaneRuntimeTabsProjectionEntry
  providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
}): WorkspacePaneTabEntry[] {
  let tabs = [...input.entry.tabs]
  if (input.entry.worktreePath === null) {
    for (const snapshot of input.providerSnapshots) {
      tabs = workspaceTabsWithoutStaleRuntimeEntries(tabs, snapshot.type, [])
    }
    return tabs
  }
  for (const snapshot of input.providerSnapshots) {
    const replacements = projectWorkspaceRuntimeTabsForWorktree({
      runtimeType: snapshot.type,
      entries: [{ ...input.entry, tabs }],
      worktreePath: input.entry.worktreePath,
      liveSessions: liveSessionsForWorktree(snapshot.liveSessions, input.entry.worktreePath),
    })
    tabs = replacements[0]?.tabs ?? tabs
  }
  return tabs
}

export function projectWorkspaceRuntimeTabsFromProviderSnapshots(input: {
  entries: readonly WorkspacePaneRuntimeTabsProjectionEntry[]
  providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
  worktreePath: string
}): WorkspacePaneRuntimeTabsProjectionReplacement[] {
  let entries = input.entries.map((entry) => ({
    branchName: entry.branchName,
    worktreePath: entry.worktreePath,
    tabs: [...entry.tabs],
  }))
  const changedKeys = new Set<string>()
  for (const snapshot of input.providerSnapshots) {
    const replacements = projectWorkspaceRuntimeTabsForWorktree({
      runtimeType: snapshot.type,
      entries,
      worktreePath: input.worktreePath,
      liveSessions: liveSessionsForWorktree(snapshot.liveSessions, input.worktreePath),
    })
    for (const replacement of replacements) {
      const key = workspacePaneTabsProjectionEntryKey(replacement)
      changedKeys.add(key)
      const index = entries.findIndex((entry) => workspacePaneTabsProjectionEntryKey(entry) === key)
      const nextEntry = {
        branchName: replacement.branchName,
        worktreePath: replacement.worktreePath,
        tabs: replacement.tabs,
      }
      if (index === -1) entries = [...entries, nextEntry]
      else entries[index] = nextEntry
    }
  }
  return entries.flatMap((entry) => {
    if (entry.worktreePath === null) return []
    return changedKeys.has(workspacePaneTabsProjectionEntryKey(entry))
      ? [{ branchName: entry.branchName, worktreePath: entry.worktreePath, tabs: entry.tabs }]
      : []
  })
}

/** Pure full-scope projection used to keep stored layout and live membership separate. */
export function projectCanonicalWorkspacePaneTabs(input: {
  entries: readonly WorkspacePaneRuntimeTabsProjectionEntry[]
  providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
}): CanonicalWorkspacePaneTabsProjectionEntry[] {
  let entries = input.entries.map((entry) => ({ ...entry, tabs: [...entry.tabs] }))
  for (const entry of entries.filter((candidate) => candidate.worktreePath === null)) {
    const index = entries.indexOf(entry)
    entries[index] = {
      ...entry,
      tabs: canonicalWorkspaceRuntimeTabsForTarget({ entry, providerSnapshots: input.providerSnapshots }),
    }
  }
  for (const worktreePath of workspaceRuntimeTabWorktreePaths({ entries, providerSnapshots: input.providerSnapshots })) {
    const replacements = projectWorkspaceRuntimeTabsFromProviderSnapshots({
      entries: entries.filter((entry) => entry.worktreePath === worktreePath),
      providerSnapshots: input.providerSnapshots,
      worktreePath,
    })
    for (const replacement of replacements) {
      const index = entries.findIndex(
        (entry) => entry.branchName === replacement.branchName && entry.worktreePath === replacement.worktreePath,
      )
      if (index === -1) entries.push(replacement)
      else entries[index] = replacement
    }
  }
  return entries
}

export function workspaceRuntimeTabWorktreePaths(input: {
  entries: readonly WorkspacePaneRuntimeTabsProjectionEntry[]
  providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
}): string[] {
  const worktreePaths = new Set(
    input.entries.flatMap((entry) => (entry.worktreePath === null ? [] : [entry.worktreePath])),
  )
  for (const snapshot of input.providerSnapshots) {
    for (const session of snapshot.liveSessions) worktreePaths.add(session.worktreePath)
  }
  return Array.from(worktreePaths)
}

export function workspaceTabsWithoutStaleRuntimeEntries(
  tabs: readonly WorkspacePaneTabEntry[],
  runtimeType: WorkspacePaneRuntimeTabType,
  liveSessionIds: readonly string[],
): WorkspacePaneTabEntry[] {
  const liveSessionIdsSet = new Set(liveSessionIds.filter((sessionId) => sessionId.length > 0))
  const seen = new Set<string>()
  const next: WorkspacePaneTabEntry[] = []
  for (const entry of tabs) {
    if (
      isWorkspacePaneRuntimeTabEntry(entry) &&
      entry.type === runtimeType &&
      !liveSessionIdsSet.has(workspacePaneRuntimeTabSessionId(entry))
    )
      continue
    const identity = workspacePaneTabEntryIdentity(entry)
    if (seen.has(identity)) continue
    seen.add(identity)
    next.push(entry)
  }
  return next
}

function liveSessionsForWorktree(
  liveSessions: readonly WorkspacePaneRuntimeTabsProviderSnapshotSession[],
  worktreePath: string,
): WorkspacePaneRuntimeTabsProjectionSession[] {
  return liveSessions.filter((session) => session.worktreePath === worktreePath)
}

function workspacePaneTabsProjectionEntryKey(input: { branchName: string; worktreePath: string | null }): string {
  return `${input.branchName}\0${input.worktreePath ?? ''}`
}
