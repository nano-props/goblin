import type { TerminalSessionSummary } from '#/shared/terminal-types.ts'
import {
  type WorkspacePaneTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
  workspacePaneTerminalTabEntry,
} from '#/shared/workspace-pane.ts'

export interface TerminalWorkspaceTabsProjectionEntry {
  branchName: string
  worktreePath: string | null
  tabs: readonly WorkspacePaneTabEntry[]
}

export interface TerminalWorkspaceTabsProjectionReplacement {
  branchName: string
  worktreePath: string
  tabs: WorkspacePaneTabEntry[]
}

export type TerminalWorkspaceTabsProjectionSession = Pick<TerminalSessionSummary, 'terminalSessionId' | 'branch'>

const DEFAULT_WORKTREE_TABS: readonly WorkspacePaneTabEntry[] = [workspacePaneStaticTabEntry('status')]

export function projectWorkspaceTerminalTabsForWorktree(input: {
  entries: readonly TerminalWorkspaceTabsProjectionEntry[]
  worktreePath: string
  liveSessions: readonly TerminalWorkspaceTabsProjectionSession[]
}): TerminalWorkspaceTabsProjectionReplacement[] {
  const replacements: TerminalWorkspaceTabsProjectionReplacement[] = []
  const liveTerminalSessionIds = input.liveSessions.map((session) => session.terminalSessionId)
  for (const entry of input.entries) {
    if (entry.worktreePath !== input.worktreePath) continue
    const nextTabs = workspaceTabsWithoutStaleTerminalEntries(entry.tabs, liveTerminalSessionIds)
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
  const existingTerminalSessionIds = new Set(
    currentTabs.flatMap((entry) => (entry.type === 'terminal' ? [entry.terminalSessionId] : [])),
  )
  const missingTerminalSessionIds = input.liveSessions
    .map((session) => session.terminalSessionId)
    .filter((terminalSessionId) => !existingTerminalSessionIds.has(terminalSessionId))
  if (missingTerminalSessionIds.length === 0) return replacements

  const nextTabs = [
    ...currentTabs,
    ...missingTerminalSessionIds.map((terminalSessionId) => workspacePaneTerminalTabEntry(terminalSessionId)),
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

export function workspaceTabsWithoutStaleTerminalEntries(
  tabs: readonly WorkspacePaneTabEntry[],
  liveTerminalSessionIds: readonly string[],
): WorkspacePaneTabEntry[] {
  const liveTerminalSessionIdsSet = new Set(
    liveTerminalSessionIds.filter((terminalSessionId) => terminalSessionId.length > 0),
  )
  const seen = new Set<string>()
  const next: WorkspacePaneTabEntry[] = []
  for (const entry of tabs) {
    if (entry.type === 'terminal' && !liveTerminalSessionIdsSet.has(entry.terminalSessionId)) continue
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
