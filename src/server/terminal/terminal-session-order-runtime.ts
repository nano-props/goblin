interface TerminalSessionOrderRecord<TUser extends string | number> {
  userId: TUser
  scope: string
  worktreePath: string
  id: string
  displayOrder: number
}

export interface TerminalSessionOrderWorktreeInput<TUser extends string | number> {
  userId: TUser
  scope: string
  worktreePath: string
}

export interface TerminalSessionOrderInput<
  TUser extends string | number,
> extends TerminalSessionOrderWorktreeInput<TUser> {
  id: string
}

export class TerminalSessionOrderRuntime<TUser extends string | number> {
  private readonly sessionsByWorktree = new Map<string, Map<string, TerminalSessionOrderRecord<TUser>>>()

  registerTerminalSessionOrder(input: TerminalSessionOrderInput<TUser>): void {
    const worktreeKey = this.worktreeKey(input)
    const views = this.sessionsByWorktree.get(worktreeKey) ?? new Map()
    if (views.has(input.id)) {
      this.sessionsByWorktree.set(worktreeKey, views)
      return
    }
    views.set(input.id, {
      userId: input.userId,
      scope: input.scope,
      worktreePath: input.worktreePath,
      id: input.id,
      displayOrder: nextDisplayOrder(views),
    })
    this.sessionsByWorktree.set(worktreeKey, views)
  }

  unregisterTerminalSessionOrder(input: TerminalSessionOrderInput<TUser>): void {
    const worktreeKey = this.worktreeKey(input)
    const views = this.sessionsByWorktree.get(worktreeKey)
    if (!views) return
    views.delete(input.id)
    if (views.size === 0) this.sessionsByWorktree.delete(worktreeKey)
  }

  sessionDisplayOrder(input: TerminalSessionOrderInput<TUser>): number | null {
    return this.sessionsByWorktree.get(this.worktreeKey(input))?.get(input.id)?.displayOrder ?? null
  }

  closeSessionsForUser(userId: TUser): void {
    for (const [key, views] of Array.from(this.sessionsByWorktree.entries())) {
      const hasUserViews = Array.from(views.values()).some((view) => view.userId === userId)
      if (hasUserViews) this.sessionsByWorktree.delete(key)
    }
  }

  private worktreeKey(input: TerminalSessionOrderWorktreeInput<TUser>): string {
    return `${String(input.userId)}\0${input.scope}\0${input.worktreePath}`
  }
}

export function createTerminalSessionOrderRuntime<TUser extends string | number>(): TerminalSessionOrderRuntime<TUser> {
  return new TerminalSessionOrderRuntime<TUser>()
}

function nextDisplayOrder<TUser extends string | number>(
  views: ReadonlyMap<string, TerminalSessionOrderRecord<TUser>>,
): number {
  let max = -1
  for (const view of views.values()) {
    if (view.displayOrder > max) max = view.displayOrder
  }
  return max + 1
}
