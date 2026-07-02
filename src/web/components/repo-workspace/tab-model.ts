import type {
  WorkspacePaneStaticTabType,
  WorkspacePaneTabEntry,
  WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import { resolveRenderableWorkspacePaneTab } from '#/web/lib/workspace-pane-tab.ts'
import type { WorkspacePaneTabSummary } from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import {
  PENDING_TERMINAL_WORKSPACE_PANE_TAB_IDENTITY,
  isTerminalWorkspacePaneTab,
} from '#/web/components/workspace-pane/workspace-pane-tab-summary.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { normalizeWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs.ts'
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
  terminalSessionId: string
}

export interface RepoWorkspacePendingTab extends RepoWorkspaceTabBase {
  identity: typeof PENDING_TERMINAL_WORKSPACE_PANE_TAB_IDENTITY
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
      tab: WorkspacePaneTabType
      materializedTab: RepoWorkspaceMaterializedTab
    }
  | {
      /** Render the terminal host even though no terminal tab exists yet. */
      kind: 'terminal-host'
      tab: 'terminal'
      materializedTab: null
    }

export interface RepoWorkspaceTabModel {
  repoId: string
  branchName: string | null
  worktreePath: string | null
  terminalWorktreeKey: string | null
  terminalBase: TerminalSessionBase | null
  terminalCreatePending: boolean
  terminalSyncReady: boolean
  /** Single target-scoped mixed workspace pane tab list. */
  tabEntries: WorkspacePaneTabEntry[]
  /** Open static workspace pane tabs derived from tabEntries. */
  staticTabs: WorkspacePaneStaticTabType[]
  /** Live terminal views owned by the terminal runtime. */
  terminalViews: WorkspacePaneTabSummary[]
  tabs: RepoWorkspaceTab[]
  /** The render target for the workspace pane body. */
  selection: RepoWorkspaceSelection | null
  /** The selected tab, when a body can be rendered. */
  renderedTab: WorkspacePaneTabType | null
  /** The selected materialized tab, when one exists in the tab strip. */
  activeTab: RepoWorkspaceMaterializedTab | null
}

export interface RepoWorkspaceTabModelInput {
  repoId: string
  branchName: string | null
  worktreePath: string | null
  preferredTab: WorkspacePaneTabType
  tabEntries: readonly WorkspacePaneTabEntry[]
  runtimeTerminalViews: readonly WorkspacePaneTabSummary[]
  terminalCreatePending?: boolean
  terminalSyncReady: boolean
  /**
   * Selected terminal session id for the current worktree from the repos store.
   * The model uses this as the canonical source for which terminal tab is
   * active, making the workspace pane tab model the single authority for
   * workspace tab selection. When null (no worktree or no explicit selection),
   * the model falls back to the first available terminal tab.
   */
  selectedTerminalSessionId: string | null
}

export function createRepoWorkspaceTabModel(input: RepoWorkspaceTabModelInput): RepoWorkspaceTabModel {
  const tabEntries = input.branchName ? normalizeWorkspacePaneTabs(input.tabEntries) : []
  const worktreePath = input.branchName ? input.worktreePath : null
  const terminalWorktreeKey = worktreePath ? formatTerminalWorktreeKey(input.repoId, worktreePath) : null
  const terminalViews = terminalWorktreeKey ? input.runtimeTerminalViews.filter(isTerminalWorkspacePaneTab) : []
  const materializedTabs = materializedWorkspacePaneTabs({
    tabEntries,
    terminalViews,
    hasWorktree: !!terminalWorktreeKey,
  })
  const staticTabs = materializedTabs.flatMap((tab) => (tab.kind === 'static' ? [tab.type] : []))
  const materializedTerminalCount = materializedTabs.filter((tab) => tab.kind === 'terminal').length
  const candidateTab = resolveRenderableWorkspacePaneTab(input.preferredTab, {
    hasWorktree: !!terminalWorktreeKey,
    terminalSessionCount: materializedTerminalCount,
    terminalCreatePending: input.terminalCreatePending,
    terminalSyncReady: input.terminalSyncReady,
  })
  const materializedActiveTab = candidateTab
    ? activeRepoWorkspaceTab(materializedTabs, candidateTab, input.selectedTerminalSessionId)
    : null
  const selection = workspacePaneSelection(candidateTab, materializedActiveTab, materializedTabs)
  const pendingTab =
    selection?.kind === 'terminal-host' && input.terminalCreatePending ? pendingTerminalWorkspacePaneTab() : null
  const tabs = pendingTab ? [...materializedTabs, pendingTab] : materializedTabs

  return {
    repoId: input.repoId,
    branchName: input.branchName,
    worktreePath,
    terminalWorktreeKey,
    terminalBase:
      input.branchName && worktreePath ? { repoRoot: input.repoId, branch: input.branchName, worktreePath } : null,
    terminalCreatePending: input.terminalCreatePending ?? false,
    terminalSyncReady: input.terminalSyncReady,
    tabEntries,
    staticTabs,
    terminalViews,
    tabs,
    selection,
    renderedTab: selection?.tab ?? null,
    activeTab: selection?.kind === 'materialized-tab' ? selection.materializedTab : null,
  }
}

export function nextRepoWorkspaceTabAfterClose(
  tabs: readonly RepoWorkspaceTab[],
  closingIdentity: string,
  openerIdentity?: string | null,
): RepoWorkspaceMaterializedTab | null {
  const index = tabs.findIndex((tab) => tab.identity === closingIdentity)
  if (index === -1) return null
  // Chrome-style opener preference: if the tab that opened this one is still
  // open, reactivate it before falling back to the nearest neighbor.
  if (openerIdentity) {
    const opener = tabs.find((tab) => tab.identity === openerIdentity)
    if (opener && isMaterializedRepoWorkspaceTab(opener)) return opener
  }
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
    identity: terminalWorkspacePaneTabProvider.identity(view.terminalSessionId),
    type: 'terminal',
    kind: 'terminal',
    view,
    terminalSessionId: view.terminalSessionId,
  }
}

function pendingTerminalWorkspacePaneTab(): RepoWorkspacePendingTab {
  return {
    identity: PENDING_TERMINAL_WORKSPACE_PANE_TAB_IDENTITY,
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
  tabEntries: readonly WorkspacePaneTabEntry[]
  terminalViews: readonly TerminalWorkspacePaneTabView[]
  hasWorktree: boolean
}): RepoWorkspaceMaterializedTab[] {
  const terminalViewByTerminalSessionId = new Map(input.terminalViews.map((view) => [view.terminalSessionId, view]))
  const seenTerminals = new Set<string>()
  const tabs: RepoWorkspaceMaterializedTab[] = []

  for (const entry of input.tabEntries) {
    if (entry.type !== 'terminal') {
      if (!workspacePaneTabProvider(entry.type).canOpen({ hasWorktree: input.hasWorktree })) continue
      tabs.push(staticWorkspacePaneTab(entry.type))
      continue
    }
    if (!terminalWorkspacePaneTabProvider.canOpen({ hasWorktree: input.hasWorktree })) continue
    const terminal = terminalViewByTerminalSessionId.get(entry.terminalSessionId)
    if (!terminal || seenTerminals.has(entry.terminalSessionId)) continue
    seenTerminals.add(entry.terminalSessionId)
    tabs.push(terminalWorkspacePaneTab(terminal))
  }

  return tabs
}

function workspacePaneSelection(
  renderableTab: WorkspacePaneTabType | null,
  activeTab: RepoWorkspaceMaterializedTab | null,
  materializedTabs: readonly RepoWorkspaceMaterializedTab[],
): RepoWorkspaceSelection | null {
  if (activeTab) return { kind: 'materialized-tab', tab: activeTab.type, materializedTab: activeTab }
  // Terminal-host is reserved for the "actively waiting" states: the user
  // wants the terminal tab but no terminal session exists yet, so the new
  // terminal affordance and geometry host remain mounted.
  if (renderableTab === 'terminal') {
    return { kind: 'terminal-host', tab: 'terminal', materializedTab: null }
  }
  // Generic fallback: the preferred tab is unrenderable (no backing tab)
  // so surface the first materialized tab instead of landing on an empty pane.
  const firstTab = materializedTabs[0]
  if (firstTab) return { kind: 'materialized-tab', tab: firstTab.type, materializedTab: firstTab }
  return null
}

function activeRepoWorkspaceTab(
  tabs: readonly RepoWorkspaceMaterializedTab[],
  renderableTab: WorkspacePaneTabType,
  selectedTerminalSessionId: string | null,
): RepoWorkspaceMaterializedTab | null {
  if (renderableTab === 'terminal') {
    if (selectedTerminalSessionId) {
      const selected = tabs.find(
        (tab) => tab.kind === 'terminal' && tab.terminalSessionId === selectedTerminalSessionId,
      )
      if (selected) return selected
    }
    return tabs.find((tab) => tab.kind === 'terminal') ?? null
  }
  return tabs.find((tab) => tab.type === renderableTab) ?? null
}
