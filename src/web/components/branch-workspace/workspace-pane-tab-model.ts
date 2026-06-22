import type { WorkspacePaneStaticViewType, WorkspacePaneTabOrderEntry, WorkspacePaneView } from '#/shared/workspace-pane.ts'
import { resolveRenderableWorkspacePaneView } from '#/web/lib/workspace-pane-view.ts'
import type { TerminalSessionBase, WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'
import {
  PENDING_TERMINAL_WORKSPACE_PANE_VIEW_IDENTITY,
  isTerminalWorkspacePaneView,
  staticWorkspacePaneViewIdentity,
  workspacePaneViewIdentity,
} from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { normalizeWorkspacePaneTabOrder } from '#/web/stores/repos/workspace-pane-tabs.ts'

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
  terminalBase: TerminalSessionBase | null
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
}

export function createBranchWorkspacePaneTabModel(
  input: BranchWorkspacePaneTabModelInput,
): BranchWorkspacePaneTabModel {
  const tabOrder = input.branchName ? normalizeWorkspacePaneTabOrder(input.tabOrder) : []
  const worktreePath = input.branchName ? input.worktreePath : null
  const worktreeKey = worktreePath ? worktreeTerminalKey(input.repoId, worktreePath) : null
  const terminalViews = worktreeKey ? input.runtimeTerminalViews.filter(isTerminalWorkspacePaneView) : []
  const materializedTabs = materializedWorkspacePaneTabs({ tabOrder, terminalViews, hasWorktree: !!worktreeKey })
  const staticViews = materializedTabs.flatMap((tab) =>
    tab.kind === 'static' ? [tab.type as WorkspacePaneStaticViewType] : [],
  )
  const candidateView = resolveRenderableWorkspacePaneView(input.preferredView, {
    hasWorktree: !!worktreeKey,
    terminalSessionCount: input.terminalSessionCount,
    terminalCreatePending: input.terminalCreatePending,
    terminalSyncReady: input.terminalSyncReady,
  })
  const materializedActiveTab = candidateView ? activeBranchWorkspacePaneTab(materializedTabs, candidateView) : null
  const selection = workspacePaneSelection(candidateView, materializedActiveTab)
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
    activeTab: materializedActiveTab,
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
  return {
    identity: staticWorkspacePaneViewIdentity(type),
    type,
    kind: 'static',
    view: null,
  }
}

function terminalWorkspacePaneTab(view: TerminalWorkspacePaneTabView): BranchWorkspacePaneTerminalTab {
  return {
    identity: workspacePaneViewIdentity(view),
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
      if (entry.type === 'changes' && !input.hasWorktree) continue
      tabs.push(staticWorkspacePaneTab(entry.type))
      continue
    }
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
): BranchWorkspacePaneSelection | null {
  if (!renderableView) return null
  if (activeTab) return { kind: 'materialized-tab', view: activeTab.type, tab: activeTab }
  if (renderableView === 'terminal') return { kind: 'terminal-host', view: 'terminal', tab: null }
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
