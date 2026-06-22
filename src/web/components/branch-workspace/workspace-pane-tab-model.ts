import type { WorkspacePaneStaticViewType, WorkspacePaneTabOrderEntry, WorkspacePaneView } from '#/shared/workspace-pane.ts'
import { resolveRenderableWorkspacePaneView } from '#/web/lib/workspace-pane-view.ts'
import type { TerminalSessionBase, WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'
import {
  isTerminalWorkspacePaneView,
  staticWorkspacePaneViewIdentity,
  workspacePaneViewIdentity,
} from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { normalizeWorkspacePaneTabOrder } from '#/web/stores/repos/workspace-pane-tabs.ts'

export type BranchWorkspacePaneTabKind = 'static' | 'terminal'

export interface BranchWorkspacePaneTab {
  identity: string
  type: WorkspacePaneView
  kind: BranchWorkspacePaneTabKind
  view: WorkspacePaneViewSummary | null
  key?: string
  selected?: boolean
}

export type BranchWorkspacePaneSelection =
  | {
      kind: 'materialized-tab'
      view: WorkspacePaneView
      tab: BranchWorkspacePaneTab
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
  activeTab: BranchWorkspacePaneTab | null
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
  const tabs = materializedWorkspacePaneTabs({ tabOrder, terminalViews, hasWorktree: !!worktreeKey })
  const staticViews = tabs.flatMap((tab) => (tab.kind === 'static' ? [tab.type as WorkspacePaneStaticViewType] : []))
  const candidateView = resolveRenderableWorkspacePaneView(input.preferredView, {
    hasWorktree: !!worktreeKey,
    terminalSessionCount: input.terminalSessionCount,
    terminalCreatePending: input.terminalCreatePending,
    terminalSyncReady: input.terminalSyncReady,
  })
  const activeTab = candidateView ? activeBranchWorkspacePaneTab(tabs, candidateView) : null
  const selection = workspacePaneSelection(candidateView, activeTab)

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
    activeTab,
  }
}

export function nextBranchWorkspacePaneTabAfterClose(
  tabs: readonly BranchWorkspacePaneTab[],
  closingIdentity: string,
): BranchWorkspacePaneTab | null {
  const index = tabs.findIndex((tab) => tab.identity === closingIdentity)
  if (index === -1) return null
  return tabs[index + 1] ?? tabs[index - 1] ?? null
}

export function adjacentBranchWorkspacePaneTab(
  tabs: readonly BranchWorkspacePaneTab[],
  activeIdentity: string | null | undefined,
  direction: 1 | -1,
): BranchWorkspacePaneTab | null {
  if (tabs.length === 0) return null
  if (!activeIdentity) return null
  const activeIndex = tabs.findIndex((tab) => tab.identity === activeIdentity)
  if (activeIndex === -1) return null
  const nextIndex = (activeIndex + direction + tabs.length) % tabs.length
  return tabs[nextIndex] ?? null
}

function staticWorkspacePaneTab(type: WorkspacePaneStaticViewType): BranchWorkspacePaneTab {
  return {
    identity: staticWorkspacePaneViewIdentity(type),
    type,
    kind: 'static',
    view: null,
  }
}

function terminalWorkspacePaneTab(view: WorkspacePaneViewSummary): BranchWorkspacePaneTab {
  return {
    identity: workspacePaneViewIdentity(view),
    type: view.type,
    kind: 'terminal',
    view,
    ...(isTerminalWorkspacePaneView(view) ? { key: view.key, selected: view.selected } : {}),
  }
}

function materializedWorkspacePaneTabs(input: {
  tabOrder: readonly WorkspacePaneTabOrderEntry[]
  terminalViews: readonly WorkspacePaneViewSummary[]
  hasWorktree: boolean
}): BranchWorkspacePaneTab[] {
  const terminalById = new Map(input.terminalViews.map((view) => [view.id, view]))
  const seenTerminals = new Set<string>()
  const tabs: BranchWorkspacePaneTab[] = []

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
  activeTab: BranchWorkspacePaneTab | null,
): BranchWorkspacePaneSelection | null {
  if (!renderableView) return null
  if (activeTab) return { kind: 'materialized-tab', view: activeTab.type, tab: activeTab }
  if (renderableView === 'terminal') return { kind: 'terminal-host', view: 'terminal', tab: null }
  return null
}

function activeBranchWorkspacePaneTab(
  tabs: readonly BranchWorkspacePaneTab[],
  renderableView: WorkspacePaneView,
): BranchWorkspacePaneTab | null {
  if (renderableView === 'terminal') {
    return (
      tabs.find((tab) => tab.type === 'terminal' && tab.selected && tab.key !== undefined) ??
      tabs.find((tab) => tab.type === 'terminal' && tab.key !== undefined) ??
      null
    )
  }
  return tabs.find((tab) => tab.type === renderableView) ?? null
}
