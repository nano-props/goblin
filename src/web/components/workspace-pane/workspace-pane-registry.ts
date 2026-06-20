import type {
  WorkspacePaneStaticViewSummary as ServerWorkspacePaneStaticViewSummary,
  WorkspacePaneStaticViewType,
  WorkspacePaneViewOrderEntry,
} from '#/shared/workspace-pane.ts'
import { worktreeTerminalKey, parseWorktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import type { WorkspacePaneStaticViewSummary, WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'
import { isWorktreeLevelWorkspacePaneView } from '#/web/lib/workspace-pane-view.ts'

export class RendererWorkspacePaneRegistry {
  private readonly staticViewsByWorktree = new Map<string, WorkspacePaneStaticViewSummary[]>()

  destroy(): void {
    this.staticViewsByWorktree.clear()
  }

  staticViews(worktreeKey: string): WorkspacePaneStaticViewSummary[] {
    return this.staticViewsByWorktree.get(worktreeKey) ?? []
  }

  snapshotStaticViews(worktreeKey: string): WorkspacePaneStaticViewSummary[] {
    return this.staticViews(worktreeKey).slice()
  }

  restoreStaticViews(worktreeKey: string, staticWorkspacePaneViews: WorkspacePaneStaticViewSummary[]): void {
    if (staticWorkspacePaneViews.length > 0) this.staticViewsByWorktree.set(worktreeKey, staticWorkspacePaneViews)
    else this.staticViewsByWorktree.delete(worktreeKey)
  }

  reconcileServerStaticViews(repoRoot: string, tabs: ServerWorkspacePaneStaticViewSummary[]): string[] {
    const previousWorktrees = new Set(
      Array.from(this.staticViewsByWorktree.keys()).filter((key) => key.startsWith(`${repoRoot}\0`)),
    )
    const nextByWorktree = new Map<string, WorkspacePaneStaticViewSummary[]>()

    for (const tab of tabs) {
      if (!isWorktreeLevelWorkspacePaneView(tab.type)) continue
      const terminalWorktreeKey = worktreeTerminalKey(repoRoot, tab.worktreePath)
      const summary: WorkspacePaneStaticViewSummary = {
        type: tab.type,
        id: tab.type,
        key: tab.type,
        worktreeTerminalKey: terminalWorktreeKey,
        worktreePath: tab.worktreePath,
        displayOrder: tab.displayOrder,
      }
      const current = nextByWorktree.get(terminalWorktreeKey) ?? []
      current.push(summary)
      nextByWorktree.set(terminalWorktreeKey, current)
    }

    const changedWorktrees = new Set<string>(previousWorktrees)
    for (const [terminalWorktreeKey, nextTabs] of nextByWorktree) {
      nextTabs.sort((a, b) => a.displayOrder - b.displayOrder || a.type.localeCompare(b.type))
      this.staticViewsByWorktree.set(terminalWorktreeKey, nextTabs)
      changedWorktrees.add(terminalWorktreeKey)
    }
    for (const worktreeKey of previousWorktrees) {
      if (!nextByWorktree.has(worktreeKey)) this.staticViewsByWorktree.delete(worktreeKey)
    }
    return Array.from(changedWorktrees)
  }

  validateReorder(input: {
    worktreeKey: string
    orderedViews: WorkspacePaneViewOrderEntry[]
    existingTerminalKeys: string[]
  }): boolean {
    if (new Set(input.orderedViews.map((tab) => `${tab.type}\0${tab.id}`)).size !== input.orderedViews.length) {
      return false
    }

    const orderedTerminalKeys = input.orderedViews.filter((tab) => tab.type === 'terminal').map((tab) => tab.id)
    if (orderedTerminalKeys.length !== input.existingTerminalKeys.length) return false
    const existingTerminalKeySet = new Set(input.existingTerminalKeys)
    if (!orderedTerminalKeys.every((key) => existingTerminalKeySet.has(key))) return false

    const existingStaticTypes = new Set(this.staticViews(input.worktreeKey).map((tab) => tab.type))
    const orderedStaticTypes: WorkspacePaneStaticViewType[] = []
    for (const tab of input.orderedViews) {
      if (tab.type === 'terminal') continue
      if (!isWorktreeLevelWorkspacePaneView(tab.type)) return false
      orderedStaticTypes.push(tab.type)
    }
    if (orderedStaticTypes.length !== existingStaticTypes.size) return false
    if (!orderedStaticTypes.every((type) => existingStaticTypes.has(type))) return false

    for (const tab of input.orderedViews) {
      if (tab.type === 'terminal') continue
      if (tab.id !== tab.type) return false
    }
    return true
  }

  applyOptimisticWorkspacePaneViewOrder(
    worktreeKey: string,
    orderedViews: WorkspacePaneViewOrderEntry[],
    displayOrderByKey: Map<string, number>,
  ): void {
    const parsedWorktree = parseWorktreeTerminalKey(worktreeKey)
    if (!parsedWorktree) return
    const staticWorkspacePaneViews: WorkspacePaneStaticViewSummary[] = []
    for (let i = 0; i < orderedViews.length; i++) {
      const tab = orderedViews[i]
      if (tab.type === 'terminal') {
        displayOrderByKey.set(tab.id, i)
        continue
      }
      if (!isWorktreeLevelWorkspacePaneView(tab.type)) return
      staticWorkspacePaneViews.push({
        type: tab.type,
        id: tab.type,
        key: tab.type,
        worktreeTerminalKey: worktreeKey,
        worktreePath: parsedWorktree.worktreePath,
        displayOrder: i,
      })
    }
    this.restoreStaticViews(worktreeKey, staticWorkspacePaneViews)
  }

  applyOptimisticStaticWorkspacePaneViewOpen(input: {
    worktreeKey: string
    type: WorkspacePaneStaticViewType
    currentWorkspacePaneViews: WorkspacePaneViewSummary[]
  }): void {
    if (!isWorktreeLevelWorkspacePaneView(input.type)) return
    const parsedWorktree = parseWorktreeTerminalKey(input.worktreeKey)
    if (!parsedWorktree) return
    const currentStaticViews = this.staticViews(input.worktreeKey)
    if (currentStaticViews.some((tab) => tab.type === input.type)) return
    const displayOrder = input.currentWorkspacePaneViews.reduce((max, tab) => Math.max(max, tab.displayOrder), -1) + 1
    this.staticViewsByWorktree.set(input.worktreeKey, [
      ...currentStaticViews,
      {
        type: input.type,
        id: input.type,
        key: input.type,
        worktreeTerminalKey: input.worktreeKey,
        worktreePath: parsedWorktree.worktreePath,
        displayOrder,
      },
    ])
  }

  applyOptimisticStaticWorkspacePaneViewClose(worktreeKey: string, type: WorkspacePaneStaticViewType): void {
    const nextStaticViews = this.staticViews(worktreeKey).filter((tab) => tab.type !== type)
    this.restoreStaticViews(worktreeKey, nextStaticViews)
  }
}
