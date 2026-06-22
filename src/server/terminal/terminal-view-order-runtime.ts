interface TerminalViewOrderRecord<TOwner extends string | number> {
  ownerId: TOwner
  scope: string
  worktreePath: string
  id: string
  displayOrder: number
}

export interface TerminalViewOrderWorktreeInput<TOwner extends string | number> {
  ownerId: TOwner
  scope: string
  worktreePath: string
}

export interface TerminalViewOrderInput<TOwner extends string | number>
  extends TerminalViewOrderWorktreeInput<TOwner> {
  id: string
}

export class TerminalViewOrderRuntime<TOwner extends string | number> {
  private readonly viewsByWorktree = new Map<string, Map<string, TerminalViewOrderRecord<TOwner>>>()

  registerTerminalView(input: TerminalViewOrderInput<TOwner>): void {
    const worktreeKey = this.worktreeKey(input)
    const views = this.viewsByWorktree.get(worktreeKey) ?? new Map()
    if (views.has(input.id)) {
      this.viewsByWorktree.set(worktreeKey, views)
      return
    }
    views.set(input.id, {
      ownerId: input.ownerId,
      scope: input.scope,
      worktreePath: input.worktreePath,
      id: input.id,
      displayOrder: nextDisplayOrder(views),
    })
    this.viewsByWorktree.set(worktreeKey, views)
  }

  unregisterTerminalView(input: TerminalViewOrderInput<TOwner>): void {
    const worktreeKey = this.worktreeKey(input)
    const views = this.viewsByWorktree.get(worktreeKey)
    if (!views) return
    views.delete(input.id)
    if (views.size === 0) this.viewsByWorktree.delete(worktreeKey)
  }

  viewDisplayOrder(input: TerminalViewOrderInput<TOwner>): number | null {
    return this.viewsByWorktree.get(this.worktreeKey(input))?.get(input.id)?.displayOrder ?? null
  }

  closeViewsForOwner(ownerId: TOwner): void {
    for (const [key, views] of Array.from(this.viewsByWorktree.entries())) {
      const hasOwnerViews = Array.from(views.values()).some((view) => view.ownerId === ownerId)
      if (hasOwnerViews) this.viewsByWorktree.delete(key)
    }
  }

  private worktreeKey(input: TerminalViewOrderWorktreeInput<TOwner>): string {
    return `${String(input.ownerId)}\0${input.scope}\0${input.worktreePath}`
  }
}

export function createTerminalViewOrderRuntime<TOwner extends string | number>(): TerminalViewOrderRuntime<TOwner> {
  return new TerminalViewOrderRuntime<TOwner>()
}

function nextDisplayOrder<TOwner extends string | number>(
  views: ReadonlyMap<string, TerminalViewOrderRecord<TOwner>>,
): number {
  let max = -1
  for (const view of views.values()) {
    if (view.displayOrder > max) max = view.displayOrder
  }
  return max + 1
}
