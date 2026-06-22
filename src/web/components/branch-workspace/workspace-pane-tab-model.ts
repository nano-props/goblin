import type { WorkspacePaneBranchViewType, WorkspacePaneView } from '#/shared/workspace-pane.ts'
import { isBranchLevelWorkspacePaneView, resolveWorkspacePaneSelectionView } from '#/web/lib/workspace-pane-view.ts'
import type { TerminalSessionBase, WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'
import {
  isTerminalWorkspacePaneView,
  staticWorkspacePaneViewIdentity,
  workspacePaneViewIdentity,
} from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'

export type BranchWorkspacePaneTabScope = 'branch' | 'worktree'

export interface BranchWorkspacePaneTab {
  identity: string
  type: WorkspacePaneView
  scope: BranchWorkspacePaneTabScope
  view: WorkspacePaneViewSummary | null
  key?: string
  selected?: boolean
}

export interface BranchWorkspacePaneTabModel {
  repoId: string
  branchName: string | null
  worktreePath: string | null
  worktreeTerminalKey: string | null
  terminalBase: TerminalSessionBase | null
  /** Branch-scoped open-set persisted in the repo store. */
  openBranchViews: WorkspacePaneBranchViewType[]
  /** Worktree-scoped runtime views owned by the terminal runtime. */
  worktreeViews: WorkspacePaneViewSummary[]
  tabs: BranchWorkspacePaneTab[]
  selectedView: WorkspacePaneView | null
  activeTab: BranchWorkspacePaneTab | null
}

export interface BranchWorkspacePaneTabModelInput {
  repoId: string
  branchName: string | null
  worktreePath: string | null
  preferredView: WorkspacePaneView
  openBranchViews: readonly WorkspacePaneBranchViewType[]
  runtimeWorktreeViews: readonly WorkspacePaneViewSummary[]
  terminalSessionCount: number
  terminalSyncReady: boolean
}

export function createBranchWorkspacePaneTabModel(
  input: BranchWorkspacePaneTabModelInput,
): BranchWorkspacePaneTabModel {
  const openBranchViews = input.branchName ? [...input.openBranchViews] : []
  const worktreePath = input.branchName ? input.worktreePath : null
  const worktreeKey = worktreePath ? worktreeTerminalKey(input.repoId, worktreePath) : null
  const branchTabs = openBranchViews.map((type) => branchWorkspacePaneTab(type))
  const worktreeViews = worktreeKey
    ? input.runtimeWorktreeViews.filter((view) => !isBranchLevelWorkspacePaneView(view.type))
    : []
  const tabs = [...branchTabs, ...worktreeViews.map(worktreeWorkspacePaneTab)]
  const candidateView = resolveWorkspacePaneSelectionView(input.preferredView, {
    hasWorktree: !!worktreeKey,
    terminalSessionCount: input.terminalSessionCount,
    terminalSyncReady: input.terminalSyncReady,
  })
  const activeTab = candidateView ? activeBranchWorkspacePaneTab(tabs, candidateView) : null
  const selectedView = activeTab?.type ?? null

  return {
    repoId: input.repoId,
    branchName: input.branchName,
    worktreePath,
    worktreeTerminalKey: worktreeKey,
    terminalBase:
      input.branchName && worktreePath ? { repoRoot: input.repoId, branch: input.branchName, worktreePath } : null,
    openBranchViews,
    worktreeViews,
    tabs,
    selectedView,
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

function branchWorkspacePaneTab(type: WorkspacePaneBranchViewType): BranchWorkspacePaneTab {
  return {
    identity: staticWorkspacePaneViewIdentity(type),
    type,
    scope: 'branch',
    view: null,
  }
}

function worktreeWorkspacePaneTab(view: WorkspacePaneViewSummary): BranchWorkspacePaneTab {
  return {
    identity: workspacePaneViewIdentity(view),
    type: view.type,
    scope: 'worktree',
    view,
    ...(isTerminalWorkspacePaneView(view) ? { key: view.key, selected: view.selected } : {}),
  }
}

function activeBranchWorkspacePaneTab(
  tabs: readonly BranchWorkspacePaneTab[],
  selectedView: WorkspacePaneView,
): BranchWorkspacePaneTab | null {
  if (selectedView === 'terminal') {
    return (
      tabs.find((tab) => tab.type === 'terminal' && tab.selected && tab.key !== undefined) ??
      tabs.find((tab) => tab.type === 'terminal' && tab.key !== undefined) ??
      null
    )
  }
  return tabs.find((tab) => tab.type === selectedView) ?? null
}
