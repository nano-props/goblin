interface TerminalViewOrderRecord<TUser extends string | number> {
  userId: TUser
  scope: string
  worktreePath: string
  id: string
  displayOrder: number
}

export interface TerminalViewOrderWorktreeInput<TUser extends string | number> {
  userId: TUser
  scope: string
  worktreePath: string
}

export interface TerminalViewOrderInput<TUser extends string | number>
  extends TerminalViewOrderWorktreeInput<TUser> {
  id: string
}

export class TerminalViewOrderRuntime<TUser extends string | number> {
  private readonly viewsByWorktree = new Map<string, Map<string, TerminalViewOrderRecord<TUser>>>()

  registerTerminalView(input: TerminalViewOrderInput<TUser>): void {
    const worktreeKey = this.worktreeKey(input)
    const views = this.viewsByWorktree.get(worktreeKey) ?? new Map()
    if (views.has(input.id)) {
      this.viewsByWorktree.set(worktreeKey, views)
      return
    }
    views.set(input.id, {
      userId: input.userId,
      scope: input.scope,
      worktreePath: input.worktreePath,
      id: input.id,
      displayOrder: nextDisplayOrder(views),
    })
    this.viewsByWorktree.set(worktreeKey, views)
  }

  unregisterTerminalView(input: TerminalViewOrderInput<TUser>): void {
    const worktreeKey = this.worktreeKey(input)
    const views = this.viewsByWorktree.get(worktreeKey)
    if (!views) return
    views.delete(input.id)
    if (views.size === 0) this.viewsByWorktree.delete(worktreeKey)
  }

  viewDisplayOrder(input: TerminalViewOrderInput<TUser>): number | null {
    return this.viewsByWorktree.get(this.worktreeKey(input))?.get(input.id)?.displayOrder ?? null
  }

  closeViewsForUser(userId: TUser): void {
    for (const [key, views] of Array.from(this.viewsByWorktree.entries())) {
      const hasUserViews = Array.from(views.values()).some((view) => view.userId === userId)
      if (hasUserViews) this.viewsByWorktree.delete(key)
    }
  }

  private worktreeKey(input: TerminalViewOrderWorktreeInput<TUser>): string {
    return `${String(input.userId)}\0${input.scope}\0${input.worktreePath}`
  }
}

export function createTerminalViewOrderRuntime<TUser extends string | number>(): TerminalViewOrderRuntime<TUser> {
  return new TerminalViewOrderRuntime<TUser>()
}

function nextDisplayOrder<TUser extends string | number>(
  views: ReadonlyMap<string, TerminalViewOrderRecord<TUser>>,
): number {
  let max = -1
  for (const view of views.values()) {
    if (view.displayOrder > max) max = view.displayOrder
  }
  return max + 1
}
