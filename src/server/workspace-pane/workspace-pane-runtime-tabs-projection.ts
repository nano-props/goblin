import {
  isWorkspacePaneRuntimeTabEntry,
  type WorkspacePaneRuntimeTabType,
  type WorkspacePaneTabEntry,
  workspacePaneRuntimeTabEntry,
  workspacePaneRuntimeTabSessionId,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'

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

export interface WorkspacePaneRuntimeTabsProjectionSession {
  sessionId: string
  branch: string
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

export function workspacePaneTabEntryArraysEqual(
  a: readonly WorkspacePaneTabEntry[],
  b: readonly WorkspacePaneTabEntry[],
): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    const current = a[index]
    const next = b[index]
    if (!current || !next) return false
    if (workspacePaneTabEntryIdentity(current) !== workspacePaneTabEntryIdentity(next)) return false
  }
  return true
}
