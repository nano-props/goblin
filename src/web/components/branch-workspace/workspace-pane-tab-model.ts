import type { WorkspacePaneStaticViewType, WorkspacePaneTabOrderEntry, WorkspacePaneView } from '#/shared/workspace-pane.ts'
import { resolveRenderableWorkspacePaneView } from '#/web/lib/workspace-pane-view.ts'
import type { TerminalSlotBase, WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'
import {
  PENDING_TERMINAL_WORKSPACE_PANE_VIEW_IDENTITY,
  isTerminalWorkspacePaneView,
} from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-slot-keys.ts'
import { normalizeWorkspacePaneTabOrder } from '#/web/stores/repos/workspace-pane-tabs.ts'
import {
  terminalWorkspacePaneTabProvider,
  workspacePaneStaticTabProvider,
  workspacePaneTabProvider,
} from '#/web/workspace-pane/workspace-pane-tab-providers.ts'

export type BranchWorkspacePaneTabKind = 'static' | 'terminal' | 'pending'

type TerminalWorkspacePaneTabView = Extract<WorkspacePaneViewSummary, { type: 'terminal' }>

interface BranchWorkspacePaneTabBase {
  identity: string
  type: WorkspacePaneView
  kind: BranchWorkspacePaneTabKind
}

export interface BranchWorkspacePaneStaticTab extends BranchWorkspacePaneTabBase {
  type: WorkspacePaneStaticViewType
  kind: 'static'
  view: null
}

export interface BranchWorkspacePaneTerminalTab extends BranchWorkspacePaneTabBase {
  type: 'terminal'
  kind: 'terminal'
  view: TerminalWorkspacePaneTabView
  key: string
  selected: boolean
}

export interface BranchWorkspacePanePendingTab extends BranchWorkspacePaneTabBase {
  identity: typeof PENDING_TERMINAL_WORKSPACE_PANE_VIEW_IDENTITY
  type: 'terminal'
  kind: 'pending'
  view: null
  busy: true
  selected: true
}

export type BranchWorkspacePaneMaterializedTab = BranchWorkspacePaneStaticTab | BranchWorkspacePaneTerminalTab
export type BranchWorkspacePaneTab = BranchWorkspacePaneMaterializedTab | BranchWorkspacePanePendingTab

export type BranchWorkspacePaneSelection =
  | {
      kind: 'materialized-tab'
      view: WorkspacePaneView
      tab: BranchWorkspacePaneMaterializedTab
    }
  | {
      /** Render the terminal host even though no terminal tab exists yet. */
      kind: 'terminal-host'
      view: 'terminal'
      tab: null
    }

export interface BranchWorkspacePaneTabModel {
  repoId: string
  branchName: string | null
  worktreePath: string | null
  worktreeTerminalKey: string | null
  terminalBase: TerminalSlotBase | null
  /** Single branch-scoped workspace pane tab strip order. */
  tabOrder: WorkspacePaneTabOrderEntry[]
  /** Open static workspace pane views derived from tabOrder. */
  staticViews: WorkspacePaneStaticViewType[]
  /** Live terminal views owned by the terminal runtime. */
  terminalViews: WorkspacePaneViewSummary[]
  tabs: BranchWorkspacePaneTab[]
  /** The render target for the workspace pane body. */
  selection: BranchWorkspacePaneSelection | null
  /** The selected view, when a body can be rendered. */
  renderedView: WorkspacePaneView | null
  /** The selected materialized tab, when one exists in the tab strip. */
  activeTab: BranchWorkspacePaneMaterializedTab | null
}

export interface BranchWorkspacePaneTabModelInput {
  repoId: string
  branchName: string | null
  worktreePath: string | null
  preferredView: WorkspacePaneView
  tabOrder: readonly WorkspacePaneTabOrderEntry[]
  runtimeTerminalViews: readonly WorkspacePaneViewSummary[]
  terminalSessionCount: number
  terminalCreatePending?: boolean
  terminalSyncReady: boolean
  /**
   * Set by `runCloseWorkspacePaneTabCommand` after a successful user-initiated
   * close. The model uses `closingIdentity` to compute the spatial neighbor
   * from `previousTabIdentities` (pre-close tab order), then looks the
   * neighbor up in the current materialized tabs. Falls back to the generic
   * tabs[0] fallback if no neighbor exists or the neighbor is no longer in
   * the strip. Server-side terminal exits leave this null and use the
   * generic fallback. Callers must pass `null` explicitly when they have no
   * context to signal (e.g., the model is recomputed outside a close path).
   */
  lastClosedTabContext: {
    closingIdentity: string
    previousTabIdentities: readonly string[]
  } | null
}

export function createBranchWorkspacePaneTabModel(
  input: BranchWorkspacePaneTabModelInput,
): BranchWorkspacePaneTabModel {
  const tabOrder = input.branchName ? normalizeWorkspacePaneTabOrder(input.tabOrder) : []
  const worktreePath = input.branchName ? input.worktreePath : null
  const worktreeKey = worktreePath ? worktreeTerminalKey(input.repoId, worktreePath) : null
  const terminalViews = worktreeKey ? input.runtimeTerminalViews.filter(isTerminalWorkspacePaneView) : []
  const materializedTabs = materializedWorkspacePaneTabs({ tabOrder, terminalViews, hasWorktree: !!worktreeKey })
  const staticViews = materializedTabs.flatMap((tab) => (tab.kind === 'static' ? [tab.type] : []))
  const candidateView = resolveRenderableWorkspacePaneView(input.preferredView, {
    hasWorktree: !!worktreeKey,
    terminalSessionCount: input.terminalSessionCount,
    terminalCreatePending: input.terminalCreatePending,
    terminalSyncReady: input.terminalSyncReady,
  })
  const materializedActiveTab = candidateView ? activeBranchWorkspacePaneTab(materializedTabs, candidateView) : null
  const selection = workspacePaneSelection(
    candidateView,
    materializedActiveTab,
    materializedTabs,
    input.lastClosedTabContext,
  )
  const pendingTab =
    selection?.kind === 'terminal-host' && input.terminalCreatePending ? pendingTerminalWorkspacePaneTab() : null
  const tabs = pendingTab ? [...materializedTabs, pendingTab] : materializedTabs

  return {
    repoId: input.repoId,
    branchName: input.branchName,
    worktreePath,
    worktreeTerminalKey: worktreeKey,
    terminalBase:
      input.branchName && worktreePath ? { repoRoot: input.repoId, branch: input.branchName, worktreePath } : null,
    tabOrder,
    staticViews,
    terminalViews,
    tabs,
    selection,
    renderedView: selection?.view ?? null,
    activeTab: selection?.kind === 'materialized-tab' ? selection.tab : null,
  }
}

export function nextBranchWorkspacePaneTabAfterClose(
  tabs: readonly BranchWorkspacePaneTab[],
  closingIdentity: string,
): BranchWorkspacePaneMaterializedTab | null {
  const index = tabs.findIndex((tab) => tab.identity === closingIdentity)
  if (index === -1) return null
  return nextSelectableBranchWorkspacePaneTab(tabs, index, 1) ?? nextSelectableBranchWorkspacePaneTab(tabs, index, -1)
}

export function adjacentBranchWorkspacePaneTab(
  tabs: readonly BranchWorkspacePaneTab[],
  activeIdentity: string | null | undefined,
  direction: 1 | -1,
): BranchWorkspacePaneMaterializedTab | null {
  if (tabs.length === 0) return null
  if (!activeIdentity) return null
  const activeIndex = tabs.findIndex((tab) => tab.identity === activeIdentity)
  if (activeIndex === -1) return null
  for (let offset = 1; offset < tabs.length; offset += 1) {
    const nextIndex = (activeIndex + direction * offset + tabs.length) % tabs.length
    const tab = tabs[nextIndex]
    if (tab && isMaterializedBranchWorkspacePaneTab(tab)) return tab
  }
  return null
}

function staticWorkspacePaneTab(type: WorkspacePaneStaticViewType): BranchWorkspacePaneStaticTab {
  const provider = workspacePaneStaticTabProvider(type)
  return {
    identity: provider.identity(),
    type,
    kind: 'static',
    view: null,
  }
}

function terminalWorkspacePaneTab(view: TerminalWorkspacePaneTabView): BranchWorkspacePaneTerminalTab {
  return {
    identity: terminalWorkspacePaneTabProvider.identity(view.id),
    type: 'terminal',
    kind: 'terminal',
    view,
    key: view.key,
    selected: view.selected,
  }
}

function pendingTerminalWorkspacePaneTab(): BranchWorkspacePanePendingTab {
  return {
    identity: PENDING_TERMINAL_WORKSPACE_PANE_VIEW_IDENTITY,
    type: 'terminal',
    kind: 'pending',
    view: null,
    busy: true,
    selected: true,
  }
}

function nextSelectableBranchWorkspacePaneTab(
  tabs: readonly BranchWorkspacePaneTab[],
  index: number,
  direction: 1 | -1,
): BranchWorkspacePaneMaterializedTab | null {
  for (let offset = 1; offset < tabs.length; offset += 1) {
    const tab = tabs[index + direction * offset]
    if (!tab) return null
    if (isMaterializedBranchWorkspacePaneTab(tab)) return tab
  }
  return null
}

function isMaterializedBranchWorkspacePaneTab(tab: BranchWorkspacePaneTab): tab is BranchWorkspacePaneMaterializedTab {
  return tab.kind !== 'pending'
}

function materializedWorkspacePaneTabs(input: {
  tabOrder: readonly WorkspacePaneTabOrderEntry[]
  terminalViews: readonly TerminalWorkspacePaneTabView[]
  hasWorktree: boolean
}): BranchWorkspacePaneMaterializedTab[] {
  const terminalById = new Map(input.terminalViews.map((view) => [view.id, view]))
  const seenTerminals = new Set<string>()
  const tabs: BranchWorkspacePaneMaterializedTab[] = []

  for (const entry of input.tabOrder) {
    if (entry.type !== 'terminal') {
      if (!workspacePaneTabProvider(entry.type).canOpen({ hasWorktree: input.hasWorktree })) continue
      tabs.push(staticWorkspacePaneTab(entry.type))
      continue
    }
    if (!terminalWorkspacePaneTabProvider.canOpen({ hasWorktree: input.hasWorktree })) continue
    const terminal = terminalById.get(entry.id)
    if (!terminal || seenTerminals.has(entry.id)) continue
    seenTerminals.add(entry.id)
    tabs.push(terminalWorkspacePaneTab(terminal))
  }

  for (const terminal of input.terminalViews) {
    if (seenTerminals.has(terminal.id)) continue
    tabs.push(terminalWorkspacePaneTab(terminal))
  }

  return tabs
}

function workspacePaneSelection(
  renderableView: WorkspacePaneView | null,
  activeTab: BranchWorkspacePaneMaterializedTab | null,
  materializedTabs: readonly BranchWorkspacePaneMaterializedTab[],
  lastClosedTabContext: { closingIdentity: string; previousTabIdentities: readonly string[] } | null,
): BranchWorkspacePaneSelection | null {
  if (activeTab) return { kind: 'materialized-tab', view: activeTab.type, tab: activeTab }
  // Terminal-host is reserved for the "actively waiting" states — the user
  // wants the terminal view but no terminal session exists yet, so we keep
  // the new-terminal affordance reachable. Skip when a user-initiated close
  // just happened: the adjacency fallback below will land them on the
  // spatial neighbor instead.
  if (renderableView === 'terminal' && !lastClosedTabContext) {
    return { kind: 'terminal-host', view: 'terminal', tab: null }
  }
  // User-initiated close: when the user just closed a tab AND the preferred
  // view became unrenderable as a result, prefer the spatial neighbor from
  // the pre-close tab order. Falls back to the generic tabs[0] lookup below
  // if no neighbor exists or the neighbor was removed by a subsequent action.
  if (lastClosedTabContext) {
    const neighborIdentity = adjacentIdentityAfterClose(
      lastClosedTabContext.previousTabIdentities,
      lastClosedTabContext.closingIdentity,
    )
    if (neighborIdentity) {
      const neighbor = materializedTabs.find((tab) => tab.identity === neighborIdentity)
      if (neighbor) return { kind: 'materialized-tab', view: neighbor.type, tab: neighbor }
    }
  }
  // Generic fallback: the preferred view is unrenderable (no backing tab)
  // and either no user-initiated close was recorded, or the neighbor lookup
  // failed. Surface the first materialized tab so the user does not land on
  // the empty pane.
  const firstTab = materializedTabs[0]
  if (firstTab) return { kind: 'materialized-tab', view: firstTab.type, tab: firstTab }
  return null
}

function adjacentIdentityAfterClose(
  identities: readonly string[],
  closingIdentity: string,
): string | null {
  const closingIndex = identities.indexOf(closingIdentity)
  if (closingIndex === -1) return null
  for (let offset = 1; offset < identities.length; offset += 1) {
    const forward = identities[closingIndex + offset]
    if (forward !== undefined && forward !== closingIdentity) return forward
    const backward = identities[closingIndex - offset]
    if (backward !== undefined && backward !== closingIdentity) return backward
  }
  return null
}

function activeBranchWorkspacePaneTab(
  tabs: readonly BranchWorkspacePaneMaterializedTab[],
  renderableView: WorkspacePaneView,
): BranchWorkspacePaneMaterializedTab | null {
  if (renderableView === 'terminal') {
    return (
      tabs.find((tab) => tab.kind === 'terminal' && tab.selected) ??
      tabs.find((tab) => tab.kind === 'terminal') ??
      null
    )
  }
  return tabs.find((tab) => tab.type === renderableView) ?? null
}
