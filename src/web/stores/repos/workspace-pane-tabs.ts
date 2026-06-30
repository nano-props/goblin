import type { RepoUiState } from '#/web/stores/repos/types.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabOrderEntry } from '#/shared/workspace-pane.ts'
import {
  workspacePaneTabOrderEntryFromUnknown,
  workspacePaneStaticTabOrderEntry,
  workspacePaneTerminalTabOrderEntry,
  workspacePaneTabOrderEntryIdentity,
} from '#/shared/workspace-pane.ts'

const DEFAULT_WORKSPACE_PANE_TAB_ORDER: readonly WorkspacePaneTabOrderEntry[] = [
  workspacePaneStaticTabOrderEntry('status'),
]

export function workspacePaneTabOrderForBranch(
  ui: Pick<RepoUiState, 'workspacePaneTabOrderByBranch'>,
  branch: string | null | undefined,
): WorkspacePaneTabOrderEntry[] {
  if (!branch) return []
  return [...(ui.workspacePaneTabOrderByBranch[branch] ?? DEFAULT_WORKSPACE_PANE_TAB_ORDER)]
}

export function workspacePaneStaticTabsForBranch(
  ui: Pick<RepoUiState, 'workspacePaneTabOrderByBranch'>,
  branch: string | null | undefined,
): WorkspacePaneStaticTabType[] {
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

export function workspacePaneTabOrderWithStaticTab(
  current: readonly WorkspacePaneTabOrderEntry[],
  tab: WorkspacePaneStaticTabType,
): WorkspacePaneTabOrderEntry[] {
  if (current.some((entry) => entry.type === tab)) return normalizeWorkspacePaneTabOrder(current)
  return normalizeWorkspacePaneTabOrder([...current, workspacePaneStaticTabOrderEntry(tab)])
}

export function workspacePaneTabOrderWithoutStaticTab(
  current: readonly WorkspacePaneTabOrderEntry[],
  tab: WorkspacePaneStaticTabType,
): WorkspacePaneTabOrderEntry[] {
  return normalizeWorkspacePaneTabOrder(current.filter((entry) => entry.type !== tab))
}

export function workspacePaneTabOrderWithEnsuredTerminal(
  current: readonly WorkspacePaneTabOrderEntry[],
  terminalSessionId: string,
): WorkspacePaneTabOrderEntry[] {
  const normalized = normalizeWorkspacePaneTabOrder(current)
  if (terminalSessionId.length === 0) return normalized
  if (normalized.some((entry) => entry.type === 'terminal' && entry.terminalSessionId === terminalSessionId)) return normalized
  return normalizeWorkspacePaneTabOrder([...normalized, workspacePaneTerminalTabOrderEntry(terminalSessionId)])
}

export function workspacePaneTabOrderWithMaterializedTerminals(
  current: readonly WorkspacePaneTabOrderEntry[],
  terminalSessionIds: readonly string[],
): WorkspacePaneTabOrderEntry[] {
  const normalized = normalizeWorkspacePaneTabOrder(current)
  const runtimeTerminalSessionIds = uniqueNonEmptyStrings(terminalSessionIds)
  if (runtimeTerminalSessionIds.length === 0) return normalized

  const orderedTerminalSessionIds = normalized.flatMap((entry) => (entry.type === 'terminal' ? [entry.terminalSessionId] : []))
  const orderedTerminalSessionIdSet = new Set(orderedTerminalSessionIds)
  const missingTerminalSessionIds = runtimeTerminalSessionIds.filter((terminalSessionId) => !orderedTerminalSessionIdSet.has(terminalSessionId))
  if (missingTerminalSessionIds.length === 0) return normalized

  const beforeByTerminalSessionId = new Map<string, string[]>()
  const afterByTerminalSessionId = new Map<string, string[]>()
  const appendTerminalSessionIds: string[] = []
  for (const terminalSessionId of missingTerminalSessionIds) {
    const runtimeIndex = runtimeTerminalSessionIds.indexOf(terminalSessionId)
    const nextAnchor = runtimeTerminalSessionIds
      .slice(runtimeIndex + 1)
      .find((candidate) => orderedTerminalSessionIdSet.has(candidate))
    if (nextAnchor) {
      pushMapList(beforeByTerminalSessionId, nextAnchor, terminalSessionId)
      continue
    }
    const previousAnchor = runtimeTerminalSessionIds
      .slice(0, runtimeIndex)
      .reverse()
      .find((candidate) => orderedTerminalSessionIdSet.has(candidate))
    if (previousAnchor) {
      pushMapList(afterByTerminalSessionId, previousAnchor, terminalSessionId)
      continue
    }
    appendTerminalSessionIds.push(terminalSessionId)
  }

  const next: WorkspacePaneTabOrderEntry[] = []
  for (const entry of normalized) {
    if (entry.type === 'terminal') {
      for (const terminalSessionId of beforeByTerminalSessionId.get(entry.terminalSessionId) ?? []) {
        next.push(workspacePaneTerminalTabOrderEntry(terminalSessionId))
      }
      next.push(entry)
      for (const terminalSessionId of afterByTerminalSessionId.get(entry.terminalSessionId) ?? []) {
        next.push(workspacePaneTerminalTabOrderEntry(terminalSessionId))
      }
      continue
    }
    next.push(entry)
  }
  for (const terminalSessionId of appendTerminalSessionIds) next.push(workspacePaneTerminalTabOrderEntry(terminalSessionId))
  return normalizeWorkspacePaneTabOrder(next)
}

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
  const next: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (value.length === 0 || seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }
  return next
}

function pushMapList(map: Map<string, string[]>, key: string, value: string): void {
  const current = map.get(key)
  if (current) current.push(value)
  else map.set(key, [value])
}

export function workspacePaneTabOrderWithoutTerminal(
  current: readonly WorkspacePaneTabOrderEntry[],
  terminalSessionId: string,
): WorkspacePaneTabOrderEntry[] {
  return normalizeWorkspacePaneTabOrder(
    current.filter((entry) => entry.type !== 'terminal' || entry.terminalSessionId !== terminalSessionId),
  )
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
    const entry = workspacePaneTabOrderEntryFromUnknown(raw)
    if (!entry) continue
    const identity = workspacePaneTabOrderEntryIdentity(entry)
    if (seen.has(identity)) continue
    seen.add(identity)
    next.push(entry)
  }
  return next
}
