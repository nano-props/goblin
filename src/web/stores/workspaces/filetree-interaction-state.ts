import { create } from 'zustand'

export interface FiletreeInteractionSnapshot {
  readonly selectedKeys: readonly string[]
  readonly expandedKeys: readonly string[]
  readonly topVisibleRowIndex: number
}

interface FiletreeInteractionState {
  readonly interactionByScope: Readonly<Record<string, FiletreeInteractionSnapshot>>
}

interface FiletreeInteractionActions {
  readonly setSelectedKeys: (scopeKey: string, keys: readonly string[]) => void
  readonly setExpandedKeys: (scopeKey: string, keys: readonly string[]) => void
  readonly setExpandedKey: (scopeKey: string, key: string, expanded: boolean) => void
  readonly setTopVisibleRowIndex: (scopeKey: string, topVisibleRowIndex: number) => void
  readonly restoreViewState: (interactionByScope: Readonly<Record<string, FiletreeInteractionSnapshot>>) => void
  readonly pruneKeys: (scopeKey: string, validKeys: ReadonlySet<string>, loadedPrefixes?: ReadonlySet<string>) => void
}

type FiletreeInteractionStore = FiletreeInteractionState & FiletreeInteractionActions

const EMPTY_SNAPSHOT: FiletreeInteractionSnapshot = {
  selectedKeys: [],
  expandedKeys: [],
  topVisibleRowIndex: 0,
}

const INITIAL_STATE: FiletreeInteractionState = {
  interactionByScope: {},
}

export function filetreeInteractionScopeKey(workspaceId: string, worktreePath: string): string {
  return `${workspaceId}\0${worktreePath}`
}

export function parseFiletreeInteractionScopeKey(
  scopeKey: string,
): { readonly workspaceId: string; readonly worktreePath: string } | null {
  const parts = scopeKey.split('\0')
  if (parts.length !== 2) return null
  const [workspaceId, worktreePath] = parts
  return workspaceId && worktreePath ? { workspaceId, worktreePath } : null
}

export function emptyFiletreeInteractionSnapshot(): FiletreeInteractionSnapshot {
  return EMPTY_SNAPSHOT
}

export const useFiletreeInteractionStore = create<FiletreeInteractionStore>()((set) => ({
  ...INITIAL_STATE,
  setSelectedKeys: (scopeKey, keys) =>
    set((state) => updateInteractionSnapshot(state, scopeKey, { selectedKeys: normalizeKeys(keys) })),
  setExpandedKeys: (scopeKey, keys) =>
    set((state) => updateInteractionSnapshot(state, scopeKey, { expandedKeys: normalizeKeys(keys) })),
  setExpandedKey: (scopeKey, key, expanded) =>
    set((state) => {
      const current = state.interactionByScope[scopeKey] ?? EMPTY_SNAPSHOT
      const expandedSet = new Set(current.expandedKeys)
      if (expanded) expandedSet.add(key)
      else expandedSet.delete(key)
      return updateInteractionSnapshot(state, scopeKey, { expandedKeys: Array.from(expandedSet) })
    }),
  setTopVisibleRowIndex: (scopeKey, topVisibleRowIndex) =>
    set((state) =>
      updateInteractionSnapshot(state, scopeKey, {
        topVisibleRowIndex: normalizeTopVisibleRowIndex(topVisibleRowIndex),
      }),
    ),
  restoreViewState: (interactionByScope) =>
    set({
      interactionByScope: normalizedInteractionByScope(interactionByScope),
    }),
  pruneKeys: (scopeKey, validKeys, loadedPrefixes) =>
    set((state) => {
      const current = state.interactionByScope[scopeKey]
      if (!current) return state
      const selectedKeys = filterValidStringKeys(current.selectedKeys, validKeys, loadedPrefixes)
      const expandedKeys = filterValidStringKeys(current.expandedKeys, validKeys, loadedPrefixes)
      if (selectedKeys === current.selectedKeys && expandedKeys === current.expandedKeys) return state
      return updateInteractionSnapshot(state, scopeKey, { selectedKeys, expandedKeys })
    }),
}))

function updateInteractionSnapshot(
  state: FiletreeInteractionState,
  scopeKey: string,
  patch: Partial<FiletreeInteractionSnapshot>,
): FiletreeInteractionState {
  const current = state.interactionByScope[scopeKey] ?? EMPTY_SNAPSHOT
  const next: FiletreeInteractionSnapshot = {
    selectedKeys: patch.selectedKeys ?? current.selectedKeys,
    expandedKeys: patch.expandedKeys ?? current.expandedKeys,
    topVisibleRowIndex: patch.topVisibleRowIndex ?? current.topVisibleRowIndex,
  }
  if (
    arraysEqual(current.selectedKeys, next.selectedKeys) &&
    arraysEqual(current.expandedKeys, next.expandedKeys) &&
    current.topVisibleRowIndex === next.topVisibleRowIndex
  ) {
    return state
  }
  return {
    interactionByScope: {
      ...state.interactionByScope,
      [scopeKey]: next,
    },
  }
}

function normalizedInteractionByScope(
  interactionByScope: Readonly<Record<string, FiletreeInteractionSnapshot>>,
): Record<string, FiletreeInteractionSnapshot> {
  const normalized: Record<string, FiletreeInteractionSnapshot> = {}
  for (const [scopeKey, snapshot] of Object.entries(interactionByScope)) {
    if (!parseFiletreeInteractionScopeKey(scopeKey)) continue
    normalized[scopeKey] = {
      selectedKeys: normalizeKeys(snapshot.selectedKeys),
      expandedKeys: normalizeKeys(snapshot.expandedKeys),
      topVisibleRowIndex: normalizeTopVisibleRowIndex(snapshot.topVisibleRowIndex),
    }
  }
  return normalized
}

function normalizeKeys(keys: readonly string[]): readonly string[] {
  return Array.from(new Set(keys.filter((key) => key.length > 0 && !key.includes('\0'))))
}

function normalizeTopVisibleRowIndex(topVisibleRowIndex: number): number {
  return Number.isFinite(topVisibleRowIndex) ? Math.max(0, Math.floor(topVisibleRowIndex)) : 0
}

function filterValidStringKeys(
  keys: readonly string[],
  validKeys: ReadonlySet<string>,
  loadedPrefixes: ReadonlySet<string> | undefined,
): readonly string[] {
  let changed = false
  const next: string[] = []
  for (const key of keys) {
    if (validKeys.has(key) || isStillPossibleLazyKey(key, validKeys, loadedPrefixes)) {
      next.push(key)
    } else {
      changed = true
    }
  }
  return changed ? next : keys
}

function isStillPossibleLazyKey(
  key: string,
  validKeys: ReadonlySet<string>,
  loadedPrefixes: ReadonlySet<string> | undefined,
): boolean {
  if (!loadedPrefixes) return false
  for (const ancestorPrefix of ancestorPrefixesForKey(key)) {
    if (!loadedPrefixes.has(ancestorPrefix)) continue
    return validKeys.has(directChildUnderPrefix(key, ancestorPrefix))
  }
  return true
}

function ancestorPrefixesForKey(key: string): string[] {
  const prefixes: string[] = []
  let cursor = key
  while (true) {
    const slash = cursor.lastIndexOf('/')
    if (slash < 0) {
      prefixes.push('')
      return prefixes
    }
    cursor = cursor.slice(0, slash)
    prefixes.push(cursor)
  }
}

function directChildUnderPrefix(key: string, prefix: string): string {
  if (prefix === '') {
    const slash = key.indexOf('/')
    return slash < 0 ? key : key.slice(0, slash)
  }
  const rest = key.slice(prefix.length + 1)
  const slash = rest.indexOf('/')
  return slash < 0 ? key : `${prefix}/${rest.slice(0, slash)}`
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

export function resetFiletreeInteractionStore(): void {
  useFiletreeInteractionStore.setState(INITIAL_STATE)
}
