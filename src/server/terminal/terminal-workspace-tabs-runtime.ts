import {
  type WorkspacePaneTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
  workspacePaneTerminalTabEntry,
} from '#/shared/workspace-pane.ts'

export interface TerminalWorkspaceTabsWorktreeInput<TUser extends string | number> {
  userId: TUser
  scope: string
  worktreePath: string
}

export interface TerminalWorkspaceTabsReplaceInput<TUser extends string | number>
  extends TerminalWorkspaceTabsWorktreeInput<TUser> {
  tabs: readonly WorkspacePaneTabEntry[]
}

export interface TerminalWorkspaceTabsScopeInput<TUser extends string | number> {
  userId: TUser
  scope: string
}

export interface TerminalWorkspaceTabsScopeEntry {
  worktreePath: string
  tabs: WorkspacePaneTabEntry[]
}

const DEFAULT_WORKSPACE_TABS: readonly WorkspacePaneTabEntry[] = [workspacePaneStaticTabEntry('status')]

export class TerminalWorkspaceTabsRuntime<TUser extends string | number> {
  private readonly tabsByWorktree = new Map<string, WorkspacePaneTabEntry[]>()

  replaceTabs(input: TerminalWorkspaceTabsReplaceInput<TUser>): WorkspacePaneTabEntry[] {
    const worktreeKey = this.worktreeKey(input)
    const tabs = normalizeWorkspacePaneTabs(input.tabs)
    this.tabsByWorktree.set(worktreeKey, tabs)
    return [...tabs]
  }

  ensureTerminalTab(
    input: TerminalWorkspaceTabsWorktreeInput<TUser>,
    terminalSessionId: string,
  ): WorkspacePaneTabEntry[] {
    const current = this.tabs(input)
    if (terminalSessionId.length === 0) return current
    if (current.some((entry) => entry.type === 'terminal' && entry.terminalSessionId === terminalSessionId)) {
      return current
    }
    return this.replaceTabs({
      ...input,
      tabs: [...current, workspacePaneTerminalTabEntry(terminalSessionId)],
    })
  }

  removeTerminalTab(
    input: TerminalWorkspaceTabsWorktreeInput<TUser>,
    terminalSessionId: string,
  ): WorkspacePaneTabEntry[] {
    const current = this.tabs(input)
    return this.replaceTabs({
      ...input,
      tabs: current.filter((entry) => entry.type !== 'terminal' || entry.terminalSessionId !== terminalSessionId),
    })
  }

  tabs(input: TerminalWorkspaceTabsWorktreeInput<TUser>): WorkspacePaneTabEntry[] {
    return [...(this.tabsByWorktree.get(this.worktreeKey(input)) ?? DEFAULT_WORKSPACE_TABS)]
  }

  tabsForScope(input: TerminalWorkspaceTabsScopeInput<TUser>): TerminalWorkspaceTabsScopeEntry[] {
    const prefix = `${String(input.userId)}\0${input.scope}\0`
    return Array.from(this.tabsByWorktree.entries()).flatMap(([key, tabs]) => {
      if (!key.startsWith(prefix)) return []
      return [{ worktreePath: key.slice(prefix.length), tabs: [...tabs] }]
    })
  }

  terminalSessionIds(input: TerminalWorkspaceTabsWorktreeInput<TUser>): string[] {
    return this.tabs(input).flatMap((entry) => (entry.type === 'terminal' ? [entry.terminalSessionId] : []))
  }

  closeSessionsForUser(userId: TUser): void {
    const prefix = `${String(userId)}\0`
    for (const key of Array.from(this.tabsByWorktree.keys())) {
      if (key.startsWith(prefix)) this.tabsByWorktree.delete(key)
    }
  }

  private worktreeKey(input: TerminalWorkspaceTabsWorktreeInput<TUser>): string {
    return `${String(input.userId)}\0${input.scope}\0${input.worktreePath}`
  }
}

export function createTerminalWorkspaceTabsRuntime<TUser extends string | number>(): TerminalWorkspaceTabsRuntime<TUser> {
  return new TerminalWorkspaceTabsRuntime<TUser>()
}

function normalizeWorkspacePaneTabs(
  tabs: readonly WorkspacePaneTabEntry[],
): WorkspacePaneTabEntry[] {
  const next: WorkspacePaneTabEntry[] = []
  const seen = new Set<string>()
  for (const entry of tabs) {
    const normalized =
      entry.type === 'terminal' ? workspacePaneTerminalTabEntry(entry.terminalSessionId) : workspacePaneStaticTabEntry(entry.type)
    const identity = workspacePaneTabEntryIdentity(normalized)
    if (seen.has(identity)) continue
    seen.add(identity)
    next.push(normalized)
  }
  return next
}
