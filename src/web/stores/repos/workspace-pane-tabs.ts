import type { RepoUiState } from '#/web/stores/repos/types.ts'
import type { WorkspacePaneStaticViewType, WorkspacePaneTabOrderEntry } from '#/shared/workspace-pane.ts'
import {
  isWorkspacePaneTabOrderEntry,
  workspacePaneStaticTabOrderEntry,
  workspacePaneTerminalTabOrderEntry,
  workspacePaneTabOrderEntryIdentity,
} from '#/shared/workspace-pane.ts'

export const DEFAULT_WORKSPACE_PANE_TAB_ORDER: readonly WorkspacePaneTabOrderEntry[] = [
  workspacePaneStaticTabOrderEntry('status'),
]

export function workspacePaneTabOrderForBranch(
  ui: Pick<RepoUiState, 'workspacePaneTabOrderByBranch'>,
  branch: string | null | undefined,
): WorkspacePaneTabOrderEntry[] {
  if (!branch) return []
  return [...(ui.workspacePaneTabOrderByBranch[branch] ?? DEFAULT_WORKSPACE_PANE_TAB_ORDER)]
}

export function workspacePaneStaticViewsForBranch(
  ui: Pick<RepoUiState, 'workspacePaneTabOrderByBranch'>,
  branch: string | null | undefined,
): WorkspacePaneStaticViewType[] {
  return workspacePaneTabOrderForBranch(ui, branch).flatMap((entry) => (entry.type === 'terminal' ? [] : [entry.type]))
}

export function workspacePaneTabOrderRecordWith(
  ui: Pick<RepoUiState, 'workspacePaneTabOrderByBranch'>,
  branch: string,
  order: readonly WorkspacePaneTabOrderEntry[],
): Record<string, WorkspacePaneTabOrderEntry[]> {
  return {
    ...ui.workspacePaneTabOrderByBranch,
    [branch]: normalizeWorkspacePaneTabOrder(order),
  }
}

export function workspacePaneTabOrderWithStaticView(
  current: readonly WorkspacePaneTabOrderEntry[],
  view: WorkspacePaneStaticViewType,
): WorkspacePaneTabOrderEntry[] {
  if (current.some((entry) => entry.type === view)) return normalizeWorkspacePaneTabOrder(current)
  return normalizeWorkspacePaneTabOrder([...current, workspacePaneStaticTabOrderEntry(view)])
}

export function workspacePaneTabOrderWithoutStaticView(
  current: readonly WorkspacePaneTabOrderEntry[],
  view: WorkspacePaneStaticViewType,
): WorkspacePaneTabOrderEntry[] {
  return normalizeWorkspacePaneTabOrder(current.filter((entry) => entry.type !== view))
}

export function workspacePaneTabOrderWithTerminal(
  current: readonly WorkspacePaneTabOrderEntry[],
  terminalKey: string,
): WorkspacePaneTabOrderEntry[] {
  if (terminalKey.length === 0) return normalizeWorkspacePaneTabOrder(current)
  const withoutCurrentTerminal = current.filter((entry) => entry.type !== 'terminal' || entry.id !== terminalKey)
  return normalizeWorkspacePaneTabOrder([...withoutCurrentTerminal, workspacePaneTerminalTabOrderEntry(terminalKey)])
}

export function workspacePaneTabOrderWithoutTerminal(
  current: readonly WorkspacePaneTabOrderEntry[],
  terminalKey: string,
): WorkspacePaneTabOrderEntry[] {
  return normalizeWorkspacePaneTabOrder(current.filter((entry) => entry.type !== 'terminal' || entry.id !== terminalKey))
}

export function normalizeWorkspacePaneTabOrderRecord(
  value: Record<string, readonly WorkspacePaneTabOrderEntry[]>,
  branchNames: readonly string[],
): Record<string, WorkspacePaneTabOrderEntry[]> {
  const next: Record<string, WorkspacePaneTabOrderEntry[]> = {}
  for (const branch of branchNames) {
    const current = Object.prototype.hasOwnProperty.call(value, branch)
      ? value[branch]
      : DEFAULT_WORKSPACE_PANE_TAB_ORDER
    next[branch] = normalizeWorkspacePaneTabOrder(current)
  }
  return next
}
export function normalizeWorkspacePaneTabOrder(
  order: readonly WorkspacePaneTabOrderEntry[],
): WorkspacePaneTabOrderEntry[] {
  const next: WorkspacePaneTabOrderEntry[] = []
  const seen = new Set<string>()
  for (const raw of order) {
    if (!isWorkspacePaneTabOrderEntry(raw)) continue
    const entry = raw.type === 'terminal' ? { type: 'terminal' as const, id: raw.id } : workspacePaneStaticTabOrderEntry(raw.type)
    const identity = workspacePaneTabOrderEntryIdentity(entry)
    if (seen.has(identity)) continue
    seen.add(identity)
    next.push(entry)
  }
  return next
}
