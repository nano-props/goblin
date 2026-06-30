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

export function workspacePaneTabOrderWithTerminal(
  current: readonly WorkspacePaneTabOrderEntry[],
  terminalKey: string,
): WorkspacePaneTabOrderEntry[] {
  if (terminalKey.length === 0) return normalizeWorkspacePaneTabOrder(current)
  const withoutCurrentTerminal = current.filter(
    (entry) => entry.type !== 'terminal' || entry.terminalKey !== terminalKey,
  )
  return normalizeWorkspacePaneTabOrder([...withoutCurrentTerminal, workspacePaneTerminalTabOrderEntry(terminalKey)])
}

export function workspacePaneTabOrderWithMaterializedTerminals(
  current: readonly WorkspacePaneTabOrderEntry[],
  terminalKeys: readonly string[],
): WorkspacePaneTabOrderEntry[] {
  const normalized = normalizeWorkspacePaneTabOrder(current)
  const runtimeTerminalKeys = uniqueNonEmptyStrings(terminalKeys)
  if (runtimeTerminalKeys.length === 0) return normalized

  const orderedTerminalKeys = normalized.flatMap((entry) => (entry.type === 'terminal' ? [entry.terminalKey] : []))
  const orderedTerminalKeySet = new Set(orderedTerminalKeys)
  const missingTerminalKeys = runtimeTerminalKeys.filter((terminalKey) => !orderedTerminalKeySet.has(terminalKey))
  if (missingTerminalKeys.length === 0) return normalized

  const beforeByTerminalKey = new Map<string, string[]>()
  const afterByTerminalKey = new Map<string, string[]>()
  const appendTerminalKeys: string[] = []
  for (const terminalKey of missingTerminalKeys) {
    const runtimeIndex = runtimeTerminalKeys.indexOf(terminalKey)
    const nextAnchor = runtimeTerminalKeys
      .slice(runtimeIndex + 1)
      .find((candidate) => orderedTerminalKeySet.has(candidate))
    if (nextAnchor) {
      pushMapList(beforeByTerminalKey, nextAnchor, terminalKey)
      continue
    }
    const previousAnchor = runtimeTerminalKeys
      .slice(0, runtimeIndex)
      .reverse()
      .find((candidate) => orderedTerminalKeySet.has(candidate))
    if (previousAnchor) {
      pushMapList(afterByTerminalKey, previousAnchor, terminalKey)
      continue
    }
    appendTerminalKeys.push(terminalKey)
  }

  const next: WorkspacePaneTabOrderEntry[] = []
  for (const entry of normalized) {
    if (entry.type === 'terminal') {
      for (const terminalKey of beforeByTerminalKey.get(entry.terminalKey) ?? []) {
        next.push(workspacePaneTerminalTabOrderEntry(terminalKey))
      }
      next.push(entry)
      for (const terminalKey of afterByTerminalKey.get(entry.terminalKey) ?? []) {
        next.push(workspacePaneTerminalTabOrderEntry(terminalKey))
      }
      continue
    }
    next.push(entry)
  }
  for (const terminalKey of appendTerminalKeys) next.push(workspacePaneTerminalTabOrderEntry(terminalKey))
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
  terminalKey: string,
): WorkspacePaneTabOrderEntry[] {
  return normalizeWorkspacePaneTabOrder(
    current.filter((entry) => entry.type !== 'terminal' || entry.terminalKey !== terminalKey),
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
