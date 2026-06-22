import path from 'node:path'
import type {
  WorkspacePaneStaticViewSummary,
  WorkspacePaneWorktreeStaticViewType,
  WorkspacePaneWorktreeViewOrderEntry,
  WorkspacePaneViewType,
} from '#/shared/workspace-pane.ts'
import { isWorkspacePaneWorktreeStaticViewType } from '#/shared/workspace-pane.ts'

interface WorkspacePaneViewRecord<TOwner extends string | number> {
  ownerId: TOwner
  scope: string
  worktreePath: string
  type: WorkspacePaneViewType
  id: string
  displayOrder: number
}

interface WorkspacePaneViewIdentity {
  type: WorkspacePaneViewType
  id: string
}

interface WorkspacePaneWorktreeInput<TOwner extends string | number> {
  ownerId: TOwner
  scope: string
  worktreePath: string
}

interface WorkspacePaneRegisterViewInput<TOwner extends string | number>
  extends WorkspacePaneWorktreeInput<TOwner>, WorkspacePaneViewIdentity {}

export class WorkspacePaneRuntime<TOwner extends string | number> {
  private readonly viewsByWorktree = new Map<string, Map<string, WorkspacePaneViewRecord<TOwner>>>()

  registerTerminalView(input: WorkspacePaneWorktreeInput<TOwner> & { id: string }): void {
    this.registerView({ ...input, type: 'terminal', id: input.id })
  }

  unregisterTerminalView(input: WorkspacePaneWorktreeInput<TOwner> & { id: string }): void {
    this.unregisterView({ ...input, type: 'terminal', id: input.id })
  }

  viewDisplayOrder(input: WorkspacePaneRegisterViewInput<TOwner>): number | null {
    return this.viewsByWorktree.get(this.worktreeKey(input))?.get(viewKey(input))?.displayOrder ?? null
  }

  listStaticViews(ownerId: TOwner, scope: string): WorkspacePaneStaticViewSummary[] {
    const summaries: WorkspacePaneStaticViewSummary[] = []
    for (const views of this.viewsByWorktree.values()) {
      for (const view of views.values()) {
        if (view.ownerId !== ownerId || view.scope !== scope || !isWorkspacePaneWorktreeStaticViewType(view.type))
          continue
        summaries.push({
          type: view.type,
          id: view.type,
          worktreePath: view.worktreePath,
          displayOrder: view.displayOrder,
        })
      }
    }
    summaries.sort(
      (a, b) =>
        a.worktreePath.localeCompare(b.worktreePath) || a.displayOrder - b.displayOrder || a.type.localeCompare(b.type),
    )
    return summaries
  }

  openStaticView(
    ownerId: TOwner,
    scope: string,
    worktreePath: string,
    type: WorkspacePaneWorktreeStaticViewType,
  ): boolean {
    this.registerView({ ownerId, scope, worktreePath, type, id: type })
    return true
  }

  closeStaticView(
    ownerId: TOwner,
    scope: string,
    worktreePath: string,
    type: WorkspacePaneWorktreeStaticViewType,
  ): boolean {
    this.unregisterView({ ownerId, scope, worktreePath, type, id: type })
    return true
  }

  closeViewsForOwner(ownerId: TOwner): void {
    for (const [key, views] of Array.from(this.viewsByWorktree.entries())) {
      const hasOwnerViews = Array.from(views.values()).some((view) => view.ownerId === ownerId)
      if (hasOwnerViews) this.viewsByWorktree.delete(key)
    }
  }

  pruneStaticViewsForOwner(ownerId: TOwner, scope: string, liveWorktreePaths: ReadonlySet<string>): number {
    let pruned = 0
    for (const [key, views] of Array.from(this.viewsByWorktree.entries())) {
      for (const [identity, view] of Array.from(views.entries())) {
        if (view.ownerId !== ownerId || view.scope !== scope || !isWorkspacePaneWorktreeStaticViewType(view.type))
          continue
        if (liveWorktreePaths.has(path.resolve(view.worktreePath))) continue
        views.delete(identity)
        pruned += 1
      }
      if (views.size === 0) this.viewsByWorktree.delete(key)
    }
    return pruned
  }

  reorderViews(
    ownerId: TOwner,
    scope: string,
    worktreePath: string,
    orderedViews: WorkspacePaneWorktreeViewOrderEntry[],
  ): boolean {
    const key = this.worktreeKey({ ownerId, scope, worktreePath })
    const currentViews = this.viewsByWorktree.get(key) ?? new Map()
    const seen = new Set<string>()

    if (orderedViews.length !== currentViews.size) return false

    for (const view of orderedViews) {
      const identity = viewKey(view)
      if (seen.has(identity)) return false
      seen.add(identity)
      if (!currentViews.has(identity)) return false
    }

    const nextViews = new Map<string, WorkspacePaneViewRecord<TOwner>>()
    for (let i = 0; i < orderedViews.length; i++) {
      const view = orderedViews[i]
      if (!view) return false
      const identity = viewKey(view)
      const current = currentViews.get(identity)
      if (!current) return false
      nextViews.set(identity, { ...current, displayOrder: i })
    }

    if (nextViews.size === 0) this.viewsByWorktree.delete(key)
    else this.viewsByWorktree.set(key, nextViews)
    return true
  }

  private registerView(input: WorkspacePaneRegisterViewInput<TOwner>): void {
    const worktreeKey = this.worktreeKey(input)
    const views = this.viewsByWorktree.get(worktreeKey) ?? new Map()
    const identity = viewKey(input)
    if (views.has(identity)) {
      this.viewsByWorktree.set(worktreeKey, views)
      return
    }
    views.set(identity, {
      ownerId: input.ownerId,
      scope: input.scope,
      worktreePath: input.worktreePath,
      type: input.type,
      id: input.id,
      displayOrder: nextDisplayOrder(views),
    })
    this.viewsByWorktree.set(worktreeKey, views)
  }

  private unregisterView(input: WorkspacePaneRegisterViewInput<TOwner>): void {
    const worktreeKey = this.worktreeKey(input)
    const views = this.viewsByWorktree.get(worktreeKey)
    if (!views) return
    views.delete(viewKey(input))
    if (views.size === 0) this.viewsByWorktree.delete(worktreeKey)
  }

  private worktreeKey(input: WorkspacePaneWorktreeInput<TOwner>): string {
    return `${String(input.ownerId)}\0${input.scope}\0${input.worktreePath}`
  }
}

export function createWorkspacePaneRuntime<TOwner extends string | number>(): WorkspacePaneRuntime<TOwner> {
  return new WorkspacePaneRuntime<TOwner>()
}

function nextDisplayOrder<TOwner extends string | number>(
  views: ReadonlyMap<string, WorkspacePaneViewRecord<TOwner>>,
): number {
  let max = -1
  for (const view of views.values()) {
    if (view.displayOrder > max) max = view.displayOrder
  }
  return max + 1
}

function viewKey(input: WorkspacePaneViewIdentity): string {
  return `${input.type}\0${input.id}`
}
