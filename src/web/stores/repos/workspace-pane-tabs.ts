import type { RepoUiState } from '#/web/stores/repos/types.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import {
  workspacePaneTabEntryFromUnknown,
  workspacePaneStaticTabEntry,
  workspacePaneTerminalTabEntry,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'

const DEFAULT_WORKSPACE_PANE_TABS: readonly WorkspacePaneTabEntry[] = [workspacePaneStaticTabEntry('status')]

export function workspacePaneTabsForBranch(
  ui: Pick<RepoUiState, 'workspacePaneTabsByBranch'>,
  branch: string | null | undefined,
): WorkspacePaneTabEntry[] {
  if (!branch) return []
  return [...(ui.workspacePaneTabsByBranch[branch] ?? DEFAULT_WORKSPACE_PANE_TABS)]
}

export function workspacePaneStaticTabsForBranch(
  ui: Pick<RepoUiState, 'workspacePaneTabsByBranch'>,
  branch: string | null | undefined,
): WorkspacePaneStaticTabType[] {
  return workspacePaneTabsForBranch(ui, branch).flatMap((entry) => (entry.type === 'terminal' ? [] : [entry.type]))
}

export function workspacePaneTabsRecordWith(
  ui: Pick<RepoUiState, 'workspacePaneTabsByBranch'>,
  branch: string,
  tabs: readonly WorkspacePaneTabEntry[],
): Record<string, WorkspacePaneTabEntry[]> {
  return {
    ...ui.workspacePaneTabsByBranch,
    [branch]: normalizeWorkspacePaneTabs(tabs),
  }
}

export function workspacePaneTabsWithStaticTab(
  current: readonly WorkspacePaneTabEntry[],
  tab: WorkspacePaneStaticTabType,
): WorkspacePaneTabEntry[] {
  if (current.some((entry) => entry.type === tab)) return normalizeWorkspacePaneTabs(current)
  return normalizeWorkspacePaneTabs([...current, workspacePaneStaticTabEntry(tab)])
}

export function workspacePaneTabsWithoutStaticTab(
  current: readonly WorkspacePaneTabEntry[],
  tab: WorkspacePaneStaticTabType,
): WorkspacePaneTabEntry[] {
  return normalizeWorkspacePaneTabs(current.filter((entry) => entry.type !== tab))
}

export function workspacePaneTabsWithEnsuredTerminal(
  current: readonly WorkspacePaneTabEntry[],
  terminalSessionId: string,
): WorkspacePaneTabEntry[] {
  const normalized = normalizeWorkspacePaneTabs(current)
  if (terminalSessionId.length === 0) return normalized
  if (normalized.some((entry) => entry.type === 'terminal' && entry.terminalSessionId === terminalSessionId)) return normalized
  return normalizeWorkspacePaneTabs([...normalized, workspacePaneTerminalTabEntry(terminalSessionId)])
}

export function normalizeWorkspacePaneTabsRecord(
  value: Record<string, readonly WorkspacePaneTabEntry[]>,
  branchNames: readonly string[],
): Record<string, WorkspacePaneTabEntry[]> {
  const next: Record<string, WorkspacePaneTabEntry[]> = {}
  for (const branch of branchNames) {
    const current = Object.prototype.hasOwnProperty.call(value, branch)
      ? value[branch]
      : DEFAULT_WORKSPACE_PANE_TABS
    next[branch] = normalizeWorkspacePaneTabs(current)
  }
  return next
}
export function normalizeWorkspacePaneTabs(
  tabs: readonly WorkspacePaneTabEntry[],
): WorkspacePaneTabEntry[] {
  const next: WorkspacePaneTabEntry[] = []
  const seen = new Set<string>()
  for (const raw of tabs) {
    const entry = workspacePaneTabEntryFromUnknown(raw)
    if (!entry) continue
    const identity = workspacePaneTabEntryIdentity(entry)
    if (seen.has(identity)) continue
    seen.add(identity)
    next.push(entry)
  }
  return next
}
