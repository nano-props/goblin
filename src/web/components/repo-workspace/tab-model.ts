import type {
  WorkspacePaneStaticTabType,
  WorkspacePaneTabOrderEntry,
  WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import { resolveRenderableWorkspacePaneTab } from '#/web/lib/workspace-pane-tab.ts'
import type { TerminalSessionBase, WorkspacePaneTabSummary } from '#/web/components/terminal/types.ts'
import {
  PENDING_TERMINAL_WORKSPACE_PANE_VIEW_IDENTITY,
  isTerminalWorkspacePaneTab,
} from '#/web/components/workspace-pane/workspace-pane-tab-summary.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-workspace-slot-keys.ts'
import { normalizeWorkspacePaneTabOrder } from '#/web/stores/repos/workspace-pane-tabs.ts'
import {
  terminalWorkspacePaneTabProvider,
  workspacePaneStaticTabProvider,
  workspacePaneTabProvider,
} from '#/web/components/workspace-pane/tab-providers.ts'

export type RepoWorkspaceTabKind = 'static' | 'terminal' | 'pending'

type TerminalWorkspacePaneTabView = Extract<WorkspacePaneTabSummary, { type: 'terminal' }>

interface RepoWorkspaceTabBase {
  identity: string
  type: WorkspacePaneTabType
  kind: RepoWorkspaceTabKind
}

export interface RepoWorkspaceStaticTab extends RepoWorkspaceTabBase {
  type: WorkspacePaneStaticTabType
  kind: 'static'
  view: null
}

export interface RepoWorkspaceTerminalTab extends RepoWorkspaceTabBase {
  type: 'terminal'
  kind: 'terminal'
  view: TerminalWorkspacePaneTabView
  key: string
}

export interface RepoWorkspacePendingTab extends RepoWorkspaceTabBase {
  identity: typeof PENDING_TERMINAL_WORKSPACE_PANE_VIEW_IDENTITY
  type: 'terminal'
  kind: 'pending'
  view: null
  busy: true
  selected: true
}

export type RepoWorkspaceMaterializedTab = RepoWorkspaceStaticTab | RepoWorkspaceTerminalTab
export type RepoWorkspaceTab = RepoWorkspaceMaterializedTab | RepoWorkspacePendingTab

export type RepoWorkspaceSelection =
  | {
      kind: 'materialized-tab'
      view: WorkspacePaneTabType
      tab: RepoWorkspaceMaterializedTab
    }
  | {
      /** Render the terminal host even though no terminal tab exists yet. */
      kind: 'terminal-host'
      view: 'terminal'
      tab: null
    }

export interface RepoWorkspaceTabModel {
  repoId: string
  branchName: string | null
  worktreePath: string | null
  worktreeTerminalKey: string | null
  terminalBase: TerminalSessionBase | null
  terminalCreatePending: boolean
  terminalSyncReady: boolean
  /** Single branch-scoped workspace pane tab strip order. */
  tabOrder: WorkspacePaneTabOrderEntry[]
  /** Open static workspace pane views derived from tabOrder. */
  staticViews: WorkspacePaneStaticTabType[]
  /** Live terminal views owned by the terminal runtime. */
  terminalViews: WorkspacePaneTabSummary[]
  tabs: RepoWorkspaceTab[]
  /** The render target for the workspace pane body. */
  selection: RepoWorkspaceSelection | null
  /** The selected view, when a body can be rendered. */
  renderedView: WorkspacePaneTabType | null
  /** The selected materialized tab, when one exists in the tab strip. */
  activeTab: RepoWorkspaceMaterializedTab | null
}

export interface RepoWorkspaceTabModelInput {
  repoId: string
  branchName: string | null
  worktreePath: string | null
  preferredView: WorkspacePaneTabType
  tabOrder: readonly WorkspacePaneTabOrderEntry[]
  runtimeTerminalViews: readonly WorkspacePaneTabSummary[]
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
    wasActive?: boolean
  } | null
  /**
   * Selected terminal slot key for the current worktree from the repos store.
   * The model uses this as the canonical source for which terminal tab is
   * active, making the workspace pane tab model the single authority for
   * workspace tab selection. When null (no worktree or no explicit selection),
   * the model falls back to the first available terminal tab.
   */
  selectedTerminalKey: string | null
}

export function createRepoWorkspaceTabModel(input: RepoWorkspaceTabModelInput): RepoWorkspaceTabModel {
  const tabOrder = input.branchName ? normalizeWorkspacePaneTabOrder(input.tabOrder) : []
  const worktreePath = input.branchName ? input.worktreePath : null
  const worktreeKey = worktreePath ? worktreeTerminalKey(input.repoId, worktreePath) : null
  const terminalViews = worktreeKey ? input.runtimeTerminalViews.filter(isTerminalWorkspacePaneTab) : []
  const materializedTabs = materializedWorkspacePaneTabs({ tabOrder, terminalViews, hasWorktree: !!worktreeKey })
  const staticViews = materializedTabs.flatMap((tab) => (tab.kind === 'static' ? [tab.type] : []))
  const candidateView = resolveRenderableWorkspacePaneTab(input.preferredView, {
    hasWorktree: !!worktreeKey,
    terminalSessionCount: input.terminalSessionCount,
    terminalCreatePending: input.terminalCreatePending,
    terminalSyncReady: input.terminalSyncReady,
  })
  const materializedActiveTab = candidateView
    ? activeRepoWorkspaceTab(materializedTabs, candidateView, input.selectedTerminalKey)
    : null
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
    terminalCreatePending: input.terminalCreatePending ?? false,
    terminalSyncReady: input.terminalSyncReady,
    tabOrder,
    staticViews,
    terminalViews,
    tabs,
    selection,
    renderedView: selection?.view ?? null,
    activeTab: selection?.kind === 'materialized-tab' ? selection.tab : null,
  }
}

export function nextRepoWorkspaceTabAfterClose(
  tabs: readonly RepoWorkspaceTab[],
  closingIdentity: string,
): RepoWorkspaceMaterializedTab | null {
  const index = tabs.findIndex((tab) => tab.identity === closingIdentity)
  if (index === -1) return null
  return nextSelectableRepoWorkspaceTab(tabs, index, 1) ?? nextSelectableRepoWorkspaceTab(tabs, index, -1)
}

export function adjacentRepoWorkspaceTab(
  tabs: readonly RepoWorkspaceTab[],
  activeIdentity: string | null | undefined,
  direction: 1 | -1,
): RepoWorkspaceMaterializedTab | null {
  if (tabs.length === 0) return null
  if (!activeIdentity) return null
  const activeIndex = tabs.findIndex((tab) => tab.identity === activeIdentity)
  if (activeIndex === -1) return null
  for (let offset = 1; offset < tabs.length; offset += 1) {
    const nextIndex = (activeIndex + direction * offset + tabs.length) % tabs.length
    const tab = tabs[nextIndex]
    if (tab && isMaterializedRepoWorkspaceTab(tab)) return tab
  }
  return null
}

function staticWorkspacePaneTab(type: WorkspacePaneStaticTabType): RepoWorkspaceStaticTab {
  const provider = workspacePaneStaticTabProvider(type)
  return {
    identity: provider.identity(),
    type,
    kind: 'static',
    view: null,
  }
}

function terminalWorkspacePaneTab(view: TerminalWorkspacePaneTabView): RepoWorkspaceTerminalTab {
  return {
    identity: terminalWorkspacePaneTabProvider.identity(view.id),
    type: 'terminal',
    kind: 'terminal',
    view,
    key: view.key,
  }
}

function pendingTerminalWorkspacePaneTab(): RepoWorkspacePendingTab {
  return {
    identity: PENDING_TERMINAL_WORKSPACE_PANE_VIEW_IDENTITY,
    type: 'terminal',
    kind: 'pending',
    view: null,
    busy: true,
    selected: true,
  }
}

function nextSelectableRepoWorkspaceTab(
  tabs: readonly RepoWorkspaceTab[],
  index: number,
  direction: 1 | -1,
): RepoWorkspaceMaterializedTab | null {
  for (let offset = 1; offset < tabs.length; offset += 1) {
    const tab = tabs[index + direction * offset]
    if (!tab) return null
    if (isMaterializedRepoWorkspaceTab(tab)) return tab
  }
  return null
}

function isMaterializedRepoWorkspaceTab(tab: RepoWorkspaceTab): tab is RepoWorkspaceMaterializedTab {
  return tab.kind !== 'pending'
}

function materializedWorkspacePaneTabs(input: {
  tabOrder: readonly WorkspacePaneTabOrderEntry[]
  terminalViews: readonly TerminalWorkspacePaneTabView[]
  hasWorktree: boolean
}): RepoWorkspaceMaterializedTab[] {
  const terminalById = new Map(input.terminalViews.map((view) => [view.id, view]))
  const seenTerminals = new Set<string>()
  const tabs: RepoWorkspaceMaterializedTab[] = []

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
  renderableView: WorkspacePaneTabType | null,
  activeTab: RepoWorkspaceMaterializedTab | null,
  materializedTabs: readonly RepoWorkspaceMaterializedTab[],
  lastClosedTabContext: {
    closingIdentity: string
    previousTabIdentities: readonly string[]
    wasActive?: boolean
  } | null,
): RepoWorkspaceSelection | null {
  // User-initiated close of the active tab: prefer the spatial neighbor in the
  // tab strip even if the user's preferred view is still renderable through
  // another tab. Without this, closing the rightmost terminal when another
  // terminal exists would let the terminal runtime's selection jump over
  // intervening static tabs to a different terminal.
  if (lastClosedTabContext?.wasActive) {
    const neighborIdentity = adjacentIdentityAfterClose(
      lastClosedTabContext.previousTabIdentities,
      lastClosedTabContext.closingIdentity,
    )
    if (neighborIdentity) {
      const neighbor = materializedTabs.find((tab) => tab.identity === neighborIdentity)
      if (neighbor) return { kind: 'materialized-tab', view: neighbor.type, tab: neighbor }
    }
  }
  if (activeTab) return { kind: 'materialized-tab', view: activeTab.type, tab: activeTab }
  // Terminal-host is reserved for the "actively waiting" states — the user
  // wants the terminal view but no terminal session exists yet, so we keep
  // the new-terminal affordance reachable. A retained close context is only
  // useful once the preferred view is unrenderable; it must not hide the host
  // that pending terminal creation needs for geometry.
  if (renderableView === 'terminal') {
    return { kind: 'terminal-host', view: 'terminal', tab: null }
  }
  // User-initiated close of a background tab, or the preferred view became
  // unrenderable as a result of the close: prefer the spatial neighbor from
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

function adjacentIdentityAfterClose(identities: readonly string[], closingIdentity: string): string | null {
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

function activeRepoWorkspaceTab(
  tabs: readonly RepoWorkspaceMaterializedTab[],
  renderableView: WorkspacePaneTabType,
  selectedTerminalKey: string | null,
): RepoWorkspaceMaterializedTab | null {
  if (renderableView === 'terminal') {
    if (selectedTerminalKey) {
      const selected = tabs.find((tab) => tab.kind === 'terminal' && tab.key === selectedTerminalKey)
      if (selected) return selected
    }
    return tabs.find((tab) => tab.kind === 'terminal') ?? null
  }
  return tabs.find((tab) => tab.type === renderableView) ?? null
}
