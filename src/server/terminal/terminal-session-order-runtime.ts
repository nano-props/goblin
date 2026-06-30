export interface TerminalSessionOrderWorktreeInput<TUser extends string | number> {
  userId: TUser
  scope: string
  worktreePath: string
}

export interface TerminalSessionOrderReplaceInput<TUser extends string | number>
  extends TerminalSessionOrderWorktreeInput<TUser> {
  terminalKeys: readonly string[]
}

export class TerminalSessionOrderRuntime<TUser extends string | number> {
  private readonly terminalKeysByWorktree = new Map<string, string[]>()

  replaceTerminalSessionOrder(input: TerminalSessionOrderReplaceInput<TUser>): void {
    const worktreeKey = this.worktreeKey(input)
    const terminalKeys = uniqueNonEmptyStrings(input.terminalKeys)
    if (terminalKeys.length === 0) this.terminalKeysByWorktree.delete(worktreeKey)
    else this.terminalKeysByWorktree.set(worktreeKey, terminalKeys)
  }

  orderedTerminalKeys(input: TerminalSessionOrderWorktreeInput<TUser>): string[] {
    return [...(this.terminalKeysByWorktree.get(this.worktreeKey(input)) ?? [])]
  }

  closeSessionsForUser(userId: TUser): void {
    for (const key of Array.from(this.terminalKeysByWorktree.keys())) {
      if (key.startsWith(`${String(userId)}\0`)) this.terminalKeysByWorktree.delete(key)
    }
  }

  private worktreeKey(input: TerminalSessionOrderWorktreeInput<TUser>): string {
    return `${String(input.userId)}\0${input.scope}\0${input.worktreePath}`
  }
}

export function createTerminalSessionOrderRuntime<TUser extends string | number>(): TerminalSessionOrderRuntime<TUser> {
  return new TerminalSessionOrderRuntime<TUser>()
}

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
  const next: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (value.length === 0 || seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }
  return next
}
