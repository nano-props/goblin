import { selectedBranchForViewMode } from '#/web/stores/repos/branch-view-mode.ts'
import { replaceRepoState } from '#/web/stores/repos/repo-state-factory.ts'
import { persistRepoSnapshotCacheEntry } from '#/web/stores/repos/persistence.ts'
import {
  DEFAULT_WORKSPACE_PANE_SIZE,
  normalizeWorkspacePaneSize,
  normalizeWorkspaceSessionLayoutState,
} from '#/shared/workspace-layout.ts'
import type { BranchViewMode, RepoState, ReposGet, ReposSet, ReposStore } from '#/web/stores/repos/types.ts'
import {
  WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES,
  type WorkspacePaneStaticTabType,
  type WorkspacePaneTabOrderEntry,
  type WorkspacePaneTabType,
  workspacePaneTabOrderEntryIdentity,
} from '#/shared/workspace-pane.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-workspace-slot-key.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import {
  normalizeWorkspacePaneTabOrder,
  workspacePaneStaticTabsForBranch,
  workspacePaneTabOrderForBranch,
  workspacePaneTabOrderRecordWith,
  workspacePaneTabOrderWithMaterializedTerminals,
  workspacePaneTabOrderWithStaticTab,
  workspacePaneTabOrderWithTerminal,
  workspacePaneTabOrderWithoutStaticTab,
  workspacePaneTabOrderWithoutTerminal,
} from '#/web/stores/repos/workspace-pane-tabs.ts'
import {
  preferredWorkspacePaneTabForBranch,
  preferredWorkspacePaneTabByBranchRecordWith,
} from '#/web/stores/repos/workspace-pane-preferences.ts'

type RestorableWorkspaceSelectionActions = Pick<
  ReposStore,
  | 'setActive'
  | 'cycleActive'
  | 'applySessionLayoutState'
  | 'applySessionSelectedTerminalState'
  | 'setZenMode'
  | 'toggleZenMode'
  | 'setWorkspacePaneSize'
  | 'resetLayout'
  | 'setSelectedTerminal'
>

type RuntimeCoherentSelectionActions = Pick<
  ReposStore,
  | 'setBranchViewMode'
  | 'setWorkspacePaneTab'
  | 'openWorkspacePaneStaticTab'
  | 'closeWorkspacePaneStaticTab'
  | 'addWorkspacePaneTerminalTab'
  | 'addAndFocusWorkspacePaneTerminalTab'
  | 'ensureWorkspacePaneTerminalTabs'
  | 'removeWorkspacePaneTerminalTab'
  | 'reorderWorkspacePaneTabs'
  | 'selectBranch'
  | 'clearSelectedBranch'
>

function createRestorableWorkspaceSelectionActions(set: ReposSet, get: ReposGet): RestorableWorkspaceSelectionActions {
  return {
    setActive(id: string) {
      set((s) => (s.repos[id] && s.activeId !== id ? { activeId: id } : s))
    },

    cycleActive(direction: 1 | -1) {
      const { order, activeId } = get()
      if (order.length === 0) return
      const idx = activeId ? order.indexOf(activeId) : -1
      const nextIdx = idx === -1 ? 0 : (idx + direction + order.length) % order.length
      const next = order[nextIdx]
      if (next && next !== activeId) set({ activeId: next })
    },

    applySessionLayoutState(layoutState: Parameters<ReposStore['applySessionLayoutState']>[0]) {
      // One-shot boot/session restore of restorable layout fields. Runtime
      // edits are persisted later through useSessionPersistence.
      set((s) => {
        const next = normalizeWorkspaceSessionLayoutState(layoutState)
        if (s.zenMode === next.zenMode && s.workspacePaneSize === next.workspacePaneSize) {
          return s
        }
        return {
          zenMode: next.zenMode,
          workspacePaneSize: next.workspacePaneSize,
        }
      })
    },

    applySessionSelectedTerminalState(selectedTerminalKeyByTerminalWorktree: Record<string, string>) {
      // One-shot boot/session restore of per-worktree terminal selection. This
      // seeds client state; later selection changes remain client-owned.
      set((s) => {
        const current = s.selectedTerminalKeyByTerminalWorktree
        const currentEntries = Object.entries(current)
        const nextEntries = Object.entries(selectedTerminalKeyByTerminalWorktree)
        if (
          currentEntries.length === nextEntries.length &&
          nextEntries.every(([terminalWorktreeKey, key]) => current[terminalWorktreeKey] === key)
        ) {
          return s
        }
        return { selectedTerminalKeyByTerminalWorktree: { ...selectedTerminalKeyByTerminalWorktree } }
      })
    },

    setZenMode(enabled: boolean) {
      set((s) => (s.zenMode === enabled ? s : { zenMode: enabled }))
    },

    toggleZenMode() {
      set((s) => ({ zenMode: !s.zenMode }))
    },

    setWorkspacePaneSize(size: number) {
      set((s) => {
        const next = normalizeWorkspacePaneSize(size)
        if (s.workspacePaneSize === next) return s
        return { workspacePaneSize: next }
      })
    },

    resetLayout() {
      set((s) => {
        if (s.workspacePaneSize === DEFAULT_WORKSPACE_PANE_SIZE) {
          return s
        }
        return {
          workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
        }
      })
    },

    setSelectedTerminal(terminalWorktreeKey: string, key: string | null) {
      set((s) => {
        const current = s.selectedTerminalKeyByTerminalWorktree[terminalWorktreeKey]
        if (key) {
          if (current === key) return s
          return {
            selectedTerminalKeyByTerminalWorktree: {
              ...s.selectedTerminalKeyByTerminalWorktree,
              [terminalWorktreeKey]: key,
            },
          }
        }
        if (current === undefined) return s
        const selectedTerminalKeyByTerminalWorktree = { ...s.selectedTerminalKeyByTerminalWorktree }
        delete selectedTerminalKeyByTerminalWorktree[terminalWorktreeKey]
        return { selectedTerminalKeyByTerminalWorktree }
      })
    },
  }
}

function createRuntimeCoherentSelectionActions(set: ReposSet, get: ReposGet): RuntimeCoherentSelectionActions {
  // Shared post-write effects for actions that may have updated preferred workspace pane tab/branch:
  // persist the warm-restore snapshot and refresh the visible branch's pull
  // request. Centralized so every selection-changing action stays consistent.
  function afterSelectionChange(id: string, token: number, branchForPullRequest: string | null): void {
    const repo = get().repos[id]
    if (!repo) return
    persistRepoSnapshotCacheEntry(set, repo, token)
    void runRepoRefreshIntent(get, {
      kind: 'visible-pull-request-changed',
      id,
      token,
      branch: branchForPullRequest,
    })
  }

  return {
    openWorkspacePaneStaticTab(id: string, tab: WorkspacePaneStaticTabType, branchName?: string) {
      set((s) => {
        const repo = s.repos[id]
        const branch = branchName ?? repo?.ui.selectedBranch
        if (!repo || !branch) return s
        const current = workspacePaneTabOrderForBranch(repo.ui, branch)
        const next = workspacePaneTabOrderWithStaticTab(current, tab)
        if (workspacePaneTabOrdersEqual(current, next)) return s
        return replaceRepoState(s, repo, (r) => {
          r.ui.workspacePaneTabOrderByBranch = workspacePaneTabOrderRecordWith(r.ui, branch, next)
        })
      })
    },

    closeWorkspacePaneStaticTab(id: string, tab: WorkspacePaneStaticTabType, branchName?: string) {
      set((s) => {
        const repo = s.repos[id]
        const branch = branchName ?? repo?.ui.selectedBranch
        if (!repo || !branch) return s
        if (!workspacePaneStaticTabsForBranch(repo.ui, branch).includes(tab)) return s
        const current = workspacePaneTabOrderForBranch(repo.ui, branch)
        const next = workspacePaneTabOrderWithoutStaticTab(current, tab)
        return replaceRepoState(s, repo, (r) => {
          r.ui.workspacePaneTabOrderByBranch = workspacePaneTabOrderRecordWith(r.ui, branch, next)
        })
      })
    },

    addWorkspacePaneTerminalTab(id: string, terminalKey: string, branchName?: string) {
      set((s) => {
        const repo = s.repos[id]
        const branch = branchName ?? repo?.ui.selectedBranch
        if (!repo || !branch) return s
        const current = workspacePaneTabOrderForBranch(repo.ui, branch)
        const next = workspacePaneTabOrderWithTerminal(current, terminalKey)
        if (workspacePaneTabOrdersEqual(current, next)) return s
        return replaceRepoState(s, repo, (r) => {
          r.ui.workspacePaneTabOrderByBranch = workspacePaneTabOrderRecordWith(r.ui, branch, next)
        })
      })
    },

    addAndFocusWorkspacePaneTerminalTab(id: string, terminalKey: string, branchName?: string) {
      let token: number | undefined
      let viewChanged = false
      set((s) => {
        const repo = s.repos[id]
        const branch = branchName ?? repo?.ui.selectedBranch
        if (!repo || !branch) return s
        const branchState = repo.data.branches.find((candidate) => candidate.name === branch)
        const worktreePath = branchState?.worktree?.path
        if (!worktreePath) return s
        const currentOrder = workspacePaneTabOrderForBranch(repo.ui, branch)
        const nextOrder = workspacePaneTabOrderWithTerminal(currentOrder, terminalKey)
        const currentView = preferredWorkspacePaneTabForBranch(repo.ui, branch)
        const terminalWorktreeKey = formatTerminalWorktreeKey(id, worktreePath)
        const currentSelected = s.selectedTerminalKeyByTerminalWorktree[terminalWorktreeKey]
        const orderChanged = !workspacePaneTabOrdersEqual(currentOrder, nextOrder)
        viewChanged = currentView !== 'terminal'
        const selectionChanged = currentSelected !== terminalKey
        if (!orderChanged && !viewChanged && !selectionChanged) return s
        token = repo.instanceToken
        const repoPatch = replaceRepoState(s, repo, (r) => {
          if (orderChanged) {
            r.ui.workspacePaneTabOrderByBranch = workspacePaneTabOrderRecordWith(r.ui, branch, nextOrder)
          }
          if (viewChanged) {
            r.ui.preferredWorkspacePaneTabByBranch = preferredWorkspacePaneTabByBranchRecordWith(
              r.ui,
              branch,
              'terminal',
            )
          }
        })
        if (!selectionChanged) return repoPatch
        return {
          ...repoPatch,
          selectedTerminalKeyByTerminalWorktree: {
            ...s.selectedTerminalKeyByTerminalWorktree,
            [terminalWorktreeKey]: terminalKey,
          },
        }
      })
      if (!viewChanged || token === undefined) return
      const repo = get().repos[id]
      persistRepoSnapshotCacheEntry(set, repo, token)
      void runRepoRefreshIntent(get, {
        kind: 'visible-pull-request-changed',
        id,
        token,
        branch:
          repo && preferredWorkspacePaneTabForBranch(repo.ui, repo.ui.selectedBranch) === 'status'
            ? repo.ui.selectedBranch
            : null,
      })
    },

    ensureWorkspacePaneTerminalTabs(id: string, branchName: string, terminalKeys: readonly string[]) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        const current = workspacePaneTabOrderForBranch(repo.ui, branchName)
        const next = workspacePaneTabOrderWithMaterializedTerminals(current, terminalKeys)
        if (workspacePaneTabOrdersEqual(current, next)) return s
        return replaceRepoState(s, repo, (r) => {
          r.ui.workspacePaneTabOrderByBranch = workspacePaneTabOrderRecordWith(r.ui, branchName, next)
        })
      })
    },

    removeWorkspacePaneTerminalTab(id: string, terminalKey: string, branchName?: string) {
      set((s) => {
        const repo = s.repos[id]
        const branch = branchName ?? repo?.ui.selectedBranch
        if (!repo || !branch) return s
        const current = workspacePaneTabOrderForBranch(repo.ui, branch)
        const next = workspacePaneTabOrderWithoutTerminal(current, terminalKey)
        if (workspacePaneTabOrdersEqual(current, next)) return s
        return replaceRepoState(s, repo, (r) => {
          r.ui.workspacePaneTabOrderByBranch = workspacePaneTabOrderRecordWith(r.ui, branch, next)
        })
      })
    },

    reorderWorkspacePaneTabs(id: string, orderedTabs: WorkspacePaneTabOrderEntry[], branchName?: string) {
      set((s) => {
        const repo = s.repos[id]
        const branch = branchName ?? repo?.ui.selectedBranch
        if (!repo || !branch) return s
        const current = workspacePaneTabOrderForBranch(repo.ui, branch)
        const hiddenStaticTabs = hiddenWorkspacePaneStaticTabs(repo, branch)
        const currentStaticTabs = workspacePaneStaticTabsForBranch(repo.ui, branch).filter(
          (tab) => !hiddenStaticTabs.has(tab),
        )
        const next = normalizeWorkspacePaneTabOrder(orderedTabs)
        const nextStaticTabs = next.flatMap((entry) => (entry.type === 'terminal' ? [] : [entry.type]))
        if (nextStaticTabs.length !== currentStaticTabs.length) return s
        const currentStaticSet = new Set(currentStaticTabs)
        if (!nextStaticTabs.every((tab) => currentStaticSet.has(tab))) return s
        const nextOrder = mergeHiddenWorkspacePaneStaticTabs(current, next, hiddenStaticTabs)
        if (workspacePaneTabOrdersEqual(current, nextOrder)) return s
        return replaceRepoState(s, repo, (r) => {
          r.ui.workspacePaneTabOrderByBranch = workspacePaneTabOrderRecordWith(r.ui, branch, nextOrder)
        })
      })
    },

    setBranchViewMode(id: string, viewMode: BranchViewMode) {
      let changed = false
      let selectedForPullRequest: string | null = null
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.ui.branchViewMode === viewMode) return s
        changed = true
        token = repo.instanceToken
        const selectedBranch = selectedBranchForViewMode(repo, viewMode)
        const selectionChanged = selectedBranch !== repo.ui.selectedBranch
        selectedForPullRequest = selectionChanged ? selectedBranch : null
        return replaceRepoState(s, repo, (r) => {
          r.ui.branchViewMode = viewMode
          r.ui.selectedBranch = selectedBranch
        })
      })
      if (changed && token !== undefined) afterSelectionChange(id, token, selectedForPullRequest)
    },

    setWorkspacePaneTab(id: string, tab: WorkspacePaneTabType) {
      // Persists the user's branch-scoped preferred tab type verbatim.
      // Opening/closing branch tabs is owned by explicit open/close actions;
      // this action only changes selection intent.
      let changed = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        const branch = repo?.ui.selectedBranch
        const current = repo ? preferredWorkspacePaneTabForBranch(repo.ui, branch) : null
        if (!repo || !branch || current === tab) return s
        changed = true
        token = repo.instanceToken
        return replaceRepoState(s, repo, (r) => {
          const selectedBranch = r.ui.selectedBranch
          if (selectedBranch) {
            r.ui.preferredWorkspacePaneTabByBranch = preferredWorkspacePaneTabByBranchRecordWith(
              r.ui,
              selectedBranch,
              tab,
            )
          }
        })
      })
      if (!changed || token === undefined) return
      const repo = get().repos[id]
      afterSelectionChange(
        id,
        token,
        repo && preferredWorkspacePaneTabForBranch(repo.ui, repo.ui.selectedBranch) === 'status'
          ? repo.ui.selectedBranch
          : null,
      )
    },

    selectBranch(id: string, branch: string) {
      let changed = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        if (!repo.data.branches.some((b) => b.name === branch)) return s
        if (repo.ui.selectedBranch === branch) return s
        changed = true
        token = repo.instanceToken
        return replaceRepoState(s, repo, (r) => {
          r.ui.selectedBranch = branch
        })
      })
      if (changed && token !== undefined) afterSelectionChange(id, token, branch)
    },

    clearSelectedBranch(id: string) {
      let changed = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.ui.selectedBranch === null) return s
        changed = true
        token = repo.instanceToken
        return replaceRepoState(s, repo, (r) => {
          r.ui.selectedBranch = null
        })
      })
      if (changed && token !== undefined) afterSelectionChange(id, token, null)
    },
  }
}

export function createSelectionActions(set: ReposSet, get: ReposGet) {
  return {
    ...createRestorableWorkspaceSelectionActions(set, get),
    ...createRuntimeCoherentSelectionActions(set, get),
  }
}

function workspacePaneTabOrdersEqual(
  a: readonly WorkspacePaneTabOrderEntry[],
  b: readonly WorkspacePaneTabOrderEntry[],
): boolean {
  return (
    a.length === b.length &&
    b.every((entry, index) => {
      const current = a[index]
      return !!current && workspacePaneTabOrderEntryIdentity(entry) === workspacePaneTabOrderEntryIdentity(current)
    })
  )
}

function hiddenWorkspacePaneStaticTabs(repo: RepoState, branchName: string): ReadonlySet<WorkspacePaneStaticTabType> {
  const branch = repo.data.branches.find((candidate) => candidate.name === branchName)
  if (branch?.worktree?.path) return new Set()
  return new Set(WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES)
}

function mergeHiddenWorkspacePaneStaticTabs(
  current: readonly WorkspacePaneTabOrderEntry[],
  visibleOrder: readonly WorkspacePaneTabOrderEntry[],
  hiddenStaticTabs: ReadonlySet<WorkspacePaneStaticTabType>,
): WorkspacePaneTabOrderEntry[] {
  if (hiddenStaticTabs.size === 0) return [...visibleOrder]
  const visible = [...visibleOrder]
  const next: WorkspacePaneTabOrderEntry[] = []
  for (const entry of current) {
    if (entry.type !== 'terminal' && hiddenStaticTabs.has(entry.type)) {
      next.push(entry)
      continue
    }
    const replacement = visible.shift()
    if (replacement) next.push(replacement)
  }
  next.push(...visible)
  return next
}
