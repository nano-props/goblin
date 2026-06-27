import { selectedBranchForViewMode } from '#/web/stores/repos/branch-view-mode.ts'
import { replaceRepoState } from '#/web/stores/repos/helpers.ts'
import { persistRestorableRepoSnapshot } from '#/web/stores/repos/persistence.ts'
import {
  DEFAULT_WORKSPACE_PANE_SIZE,
  normalizeWorkspacePaneSize,
  normalizeWorkspaceSessionLayoutState,
} from '#/shared/workspace-layout.ts'
import type { BranchViewMode, RepoState, ReposGet, ReposSet, ReposStore } from '#/web/stores/repos/types.ts'
import {
  WORKSPACE_PANE_WORKTREE_STATIC_VIEW_TYPES,
  type WorkspacePaneStaticViewType,
  type WorkspacePaneTabOrderEntry,
  type WorkspacePaneView,
} from '#/shared/workspace-pane.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-slot-keys.ts'
import {
  normalizeWorkspacePaneTabOrder,
  workspacePaneStaticViewsForBranch,
  workspacePaneTabOrderForBranch,
  workspacePaneTabOrderRecordWith,
  workspacePaneTabOrderWithStaticView,
  workspacePaneTabOrderWithTerminal,
  workspacePaneTabOrderWithoutStaticView,
  workspacePaneTabOrderWithoutTerminal,
} from '#/web/stores/repos/workspace-pane-tabs.ts'
import {
  preferredWorkspacePaneViewForBranch,
  preferredWorkspacePaneViewByBranchRecordWith,
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
  | 'setWorkspacePaneView'
  | 'openWorkspacePaneStaticView'
  | 'closeWorkspacePaneStaticView'
  | 'addWorkspacePaneTerminalTab'
  | 'addAndFocusWorkspacePaneTerminalTab'
  | 'removeWorkspacePaneTerminalTab'
  | 'reorderWorkspacePaneTabs'
  | 'setLastClosedTabContext'
  | 'selectBranch'
  | 'clearSelectedBranch'
>

function clearLastClosedTabContextForBranch(
  set: ReposSet,
  get: ReposGet,
  id: string,
  branchName?: string,
): void {
  const branch = branchName ?? get().repos[id]?.ui.selectedBranch
  if (!branch) return
  set((s) => {
    const repo = s.repos[id]
    if (!repo || !repo.ui.lastClosedTabContextByBranch[branch]) return s
    return replaceRepoState(s, repo, (r) => {
      delete r.ui.lastClosedTabContextByBranch[branch]
    })
  })
}

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

    applySessionSelectedTerminalState(selectedTerminalByWorktree: Record<string, string>) {
      // One-shot boot/session restore of per-worktree terminal selection. This
      // seeds client state; later selection changes remain client-owned.
      set((s) => {
        const current = s.selectedTerminalByWorktree
        const currentEntries = Object.entries(current)
        const nextEntries = Object.entries(selectedTerminalByWorktree)
        if (
          currentEntries.length === nextEntries.length &&
          nextEntries.every(([worktreeKey, key]) => current[worktreeKey] === key)
        ) {
          return s
        }
        return { selectedTerminalByWorktree: { ...selectedTerminalByWorktree } }
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

    setSelectedTerminal(worktreeTerminalKey: string, key: string | null) {
      set((s) => {
        const current = s.selectedTerminalByWorktree[worktreeTerminalKey]
        if (key) {
          if (current === key) return s
          return { selectedTerminalByWorktree: { ...s.selectedTerminalByWorktree, [worktreeTerminalKey]: key } }
        }
        if (current === undefined) return s
        const selectedTerminalByWorktree = { ...s.selectedTerminalByWorktree }
        delete selectedTerminalByWorktree[worktreeTerminalKey]
        return { selectedTerminalByWorktree }
      })
    },
  }
}

function createRuntimeCoherentSelectionActions(set: ReposSet, get: ReposGet): RuntimeCoherentSelectionActions {
  // Shared post-write effects for actions that may have updated preferred workspace pane view/branch:
  // persist the warm-restore snapshot and refresh the visible branch's pull
  // request. Centralized so every selection-changing action stays consistent.
  function afterSelectionChange(id: string, token: number, branchForPullRequest: string | null): void {
    const repo = get().repos[id]
    if (!repo) return
    persistRestorableRepoSnapshot(set, repo, token)
    void runRepoRefreshIntent(get, {
      kind: 'visible-pull-request-changed',
      id,
      token,
      branch: branchForPullRequest,
    })
  }

  return {
    openWorkspacePaneStaticView(id: string, tab: WorkspacePaneStaticViewType, branchName?: string) {
      set((s) => {
        const repo = s.repos[id]
        const branch = branchName ?? repo?.ui.selectedBranch
        if (!repo || !branch) return s
        const current = workspacePaneTabOrderForBranch(repo.ui, branch)
        const next = workspacePaneTabOrderWithStaticView(current, tab)
        if (workspacePaneTabOrdersEqual(current, next)) return s
        return replaceRepoState(s, repo, (r) => {
          r.ui.workspacePaneTabOrderByBranch = workspacePaneTabOrderRecordWith(r.ui, branch, next)
        })
      })
      clearLastClosedTabContextForBranch(set, get, id, branchName)
    },

    closeWorkspacePaneStaticView(id: string, tab: WorkspacePaneStaticViewType, branchName?: string) {
      set((s) => {
        const repo = s.repos[id]
        const branch = branchName ?? repo?.ui.selectedBranch
        if (!repo || !branch) return s
        if (!workspacePaneStaticViewsForBranch(repo.ui, branch).includes(tab)) return s
        const current = workspacePaneTabOrderForBranch(repo.ui, branch)
        const next = workspacePaneTabOrderWithoutStaticView(current, tab)
        return replaceRepoState(s, repo, (r) => {
          r.ui.workspacePaneTabOrderByBranch = workspacePaneTabOrderRecordWith(r.ui, branch, next)
        })
      })
      clearLastClosedTabContextForBranch(set, get, id, branchName)
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
      clearLastClosedTabContextForBranch(set, get, id, branchName)
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
        const currentView = preferredWorkspacePaneViewForBranch(repo.ui, branch)
        const wtKey = worktreeTerminalKey(id, worktreePath)
        const currentSelected = s.selectedTerminalByWorktree[wtKey]
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
            r.ui.preferredWorkspacePaneViewByBranch = preferredWorkspacePaneViewByBranchRecordWith(
              r.ui,
              branch,
              'terminal',
            )
          }
          if (r.ui.lastClosedTabContextByBranch[branch]) {
            delete r.ui.lastClosedTabContextByBranch[branch]
          }
        })
        if (!selectionChanged) return repoPatch
        return {
          ...repoPatch,
          selectedTerminalByWorktree: { ...s.selectedTerminalByWorktree, [wtKey]: terminalKey },
        }
      })
      if (!viewChanged || token === undefined) return
      const repo = get().repos[id]
      persistRestorableRepoSnapshot(set, repo, token)
      void runRepoRefreshIntent(get, {
        kind: 'visible-pull-request-changed',
        id,
        token,
        branch:
          repo && preferredWorkspacePaneViewForBranch(repo.ui, repo.ui.selectedBranch) === 'status'
            ? repo.ui.selectedBranch
            : null,
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
      clearLastClosedTabContextForBranch(set, get, id, branchName)
    },

    reorderWorkspacePaneTabs(id: string, orderedTabs: WorkspacePaneTabOrderEntry[], branchName?: string) {
      set((s) => {
        const repo = s.repos[id]
        const branch = branchName ?? repo?.ui.selectedBranch
        if (!repo || !branch) return s
        const current = workspacePaneTabOrderForBranch(repo.ui, branch)
        const hiddenStaticViews = hiddenWorkspacePaneStaticViews(repo, branch)
        const currentStaticViews = workspacePaneStaticViewsForBranch(repo.ui, branch).filter(
          (view) => !hiddenStaticViews.has(view),
        )
        const next = normalizeWorkspacePaneTabOrder(orderedTabs)
        const nextStaticViews = next.flatMap((entry) => (entry.type === 'terminal' ? [] : [entry.type]))
        if (nextStaticViews.length !== currentStaticViews.length) return s
        const currentStaticSet = new Set(currentStaticViews)
        if (!nextStaticViews.every((view) => currentStaticSet.has(view))) return s
        const nextOrder = mergeHiddenWorkspacePaneStaticTabs(current, next, hiddenStaticViews)
        if (workspacePaneTabOrdersEqual(current, nextOrder)) return s
        return replaceRepoState(s, repo, (r) => {
          r.ui.workspacePaneTabOrderByBranch = workspacePaneTabOrderRecordWith(r.ui, branch, nextOrder)
        })
      })
      clearLastClosedTabContextForBranch(set, get, id, branchName)
    },

    setLastClosedTabContext(
      id: string,
      branchName: string,
      context: { closingIdentity: string; previousTabIdentities: readonly string[]; wasActive?: boolean },
    ) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        const current = repo.ui.lastClosedTabContextByBranch[branchName]
        if (
          current &&
          current.closingIdentity === context.closingIdentity &&
          current.wasActive === context.wasActive &&
          current.previousTabIdentities.length === context.previousTabIdentities.length &&
          current.previousTabIdentities.every((id, i) => id === context.previousTabIdentities[i])
        ) {
          return s
        }
        return replaceRepoState(s, repo, (r) => {
          r.ui.lastClosedTabContextByBranch[branchName] = {
            closingIdentity: context.closingIdentity,
            previousTabIdentities: context.previousTabIdentities as string[],
            wasActive: context.wasActive,
          }
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

    setWorkspacePaneView(id: string, tab: WorkspacePaneView) {
      // Persists the user's branch-scoped preferred view type verbatim.
      // Opening/closing branch tabs is owned by explicit open/close actions;
      // this action only changes selection intent.
      let changed = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        const branch = repo?.ui.selectedBranch
        const current = repo ? preferredWorkspacePaneViewForBranch(repo.ui, branch) : null
        if (!repo || !branch || current === tab) return s
        changed = true
        token = repo.instanceToken
        return replaceRepoState(s, repo, (r) => {
          const selectedBranch = r.ui.selectedBranch
          if (selectedBranch) {
            r.ui.preferredWorkspacePaneViewByBranch = preferredWorkspacePaneViewByBranchRecordWith(
              r.ui,
              selectedBranch,
              tab,
            )
          }
        })
      })
      if (!changed || token === undefined) return
      const repo = get().repos[id]
      clearLastClosedTabContextForBranch(set, get, id)
      afterSelectionChange(
        id,
        token,
        repo && preferredWorkspacePaneViewForBranch(repo.ui, repo.ui.selectedBranch) === 'status'
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
  return a.length === b.length && b.every((entry, index) => entry.type === a[index]?.type && entry.id === a[index]?.id)
}

function hiddenWorkspacePaneStaticViews(repo: RepoState, branchName: string): ReadonlySet<WorkspacePaneStaticViewType> {
  const branch = repo.data.branches.find((candidate) => candidate.name === branchName)
  if (branch?.worktree?.path) return new Set()
  return new Set(WORKSPACE_PANE_WORKTREE_STATIC_VIEW_TYPES)
}

function mergeHiddenWorkspacePaneStaticTabs(
  current: readonly WorkspacePaneTabOrderEntry[],
  visibleOrder: readonly WorkspacePaneTabOrderEntry[],
  hiddenStaticViews: ReadonlySet<WorkspacePaneStaticViewType>,
): WorkspacePaneTabOrderEntry[] {
  if (hiddenStaticViews.size === 0) return [...visibleOrder]
  const visible = [...visibleOrder]
  const next: WorkspacePaneTabOrderEntry[] = []
  for (const entry of current) {
    if (entry.type !== 'terminal' && hiddenStaticViews.has(entry.type)) {
      next.push(entry)
      continue
    }
    const replacement = visible.shift()
    if (replacement) next.push(replacement)
  }
  next.push(...visible)
  return next
}
