import {
  type WorkspacePaneTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
  workspacePaneTabRequiresWorktree,
  workspacePaneTerminalTabEntry,
} from '#/shared/workspace-pane.ts'

export interface WorkspacePaneTabsTargetInput<TUser extends string | number> {
  userId: TUser
  scope: string
  branchName: string
  worktreePath: string | null
}

export interface WorkspacePaneTabsReplaceInput<TUser extends string | number>
  extends WorkspacePaneTabsTargetInput<TUser> {
  tabs: readonly WorkspacePaneTabEntry[]
}

export interface WorkspacePaneTabsWorktreeInput<TUser extends string | number> {
  userId: TUser
  scope: string
  worktreePath: string
}

export interface WorkspacePaneTabsScopeInput<TUser extends string | number> {
  userId: TUser
  scope: string
}

export interface WorkspacePaneTabsScopeEntry {
  branchName: string
  worktreePath: string | null
  tabs: WorkspacePaneTabEntry[]
}

interface StoredWorkspacePaneTabsEntry {
  branchName: string
  worktreePath: string | null
  tabs: WorkspacePaneTabEntry[]
}

const DEFAULT_WORKSPACE_TABS: readonly WorkspacePaneTabEntry[] = [workspacePaneStaticTabEntry('status')]

export class WorkspacePaneTabsRuntime<TUser extends string | number> {
  private readonly tabsByTarget = new Map<string, StoredWorkspacePaneTabsEntry>()

  replaceTabs(input: WorkspacePaneTabsReplaceInput<TUser>): WorkspacePaneTabEntry[] {
    const targetKey = this.targetKey(input)
    const tabs = normalizeWorkspacePaneTabs(input.tabs, { hasWorktree: input.worktreePath !== null })
    this.tabsByTarget.set(targetKey, {
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      tabs,
    })
    return [...tabs]
  }

  ensureTerminalTab(
    input: WorkspacePaneTabsTargetInput<TUser>,
    terminalSessionId: string,
  ): WorkspacePaneTabEntry[] {
    const current = this.tabs(input)
    if (input.worktreePath === null || terminalSessionId.length === 0) return current
    if (current.some((entry) => entry.type === 'terminal' && entry.terminalSessionId === terminalSessionId)) {
      return current
    }
    return this.replaceTabs({
      ...input,
      tabs: [...current, workspacePaneTerminalTabEntry(terminalSessionId)],
    })
  }

  removeTerminalTabForWorktree(
    input: WorkspacePaneTabsWorktreeInput<TUser>,
    terminalSessionId: string,
  ): WorkspacePaneTabsScopeEntry[] {
    const updated: WorkspacePaneTabsScopeEntry[] = []
    for (const [key, entry] of this.tabsByTarget.entries()) {
      if (!this.entryBelongsToWorktree(input, key, entry)) continue
      const tabs = this.replaceTabs({
        userId: input.userId,
        scope: input.scope,
        branchName: entry.branchName,
        worktreePath: entry.worktreePath,
        tabs: entry.tabs.filter((tab) => tab.type !== 'terminal' || tab.terminalSessionId !== terminalSessionId),
      })
      updated.push({ branchName: entry.branchName, worktreePath: entry.worktreePath, tabs })
    }
    return updated
  }

  tabs(input: WorkspacePaneTabsTargetInput<TUser>): WorkspacePaneTabEntry[] {
    return [...(this.tabsByTarget.get(this.targetKey(input))?.tabs ?? DEFAULT_WORKSPACE_TABS)]
  }

  tabsForScope(input: WorkspacePaneTabsScopeInput<TUser>): WorkspacePaneTabsScopeEntry[] {
    const prefix = `${String(input.userId)}\0${input.scope}\0`
    return Array.from(this.tabsByTarget.entries()).flatMap(([key, entry]) => {
      if (!key.startsWith(prefix)) return []
      return [{ branchName: entry.branchName, worktreePath: entry.worktreePath, tabs: [...entry.tabs] }]
    })
  }

  terminalSessionIds(input: WorkspacePaneTabsWorktreeInput<TUser>): string[] {
    const entries = this.tabsForScope({ userId: input.userId, scope: input.scope }).filter(
      (entry) => entry.worktreePath === input.worktreePath,
    )
    return entries.flatMap((entry) => entry.tabs.flatMap((tab) => (tab.type === 'terminal' ? [tab.terminalSessionId] : [])))
  }

  closeSessionsForUser(userId: TUser): void {
    const prefix = `${String(userId)}\0`
    for (const key of Array.from(this.tabsByTarget.keys())) {
      if (key.startsWith(prefix)) this.tabsByTarget.delete(key)
    }
  }

  private targetKey(input: WorkspacePaneTabsTargetInput<TUser>): string {
    return `${String(input.userId)}\0${input.scope}\0${input.branchName}`
  }

  private entryBelongsToWorktree(
    input: WorkspacePaneTabsWorktreeInput<TUser>,
    key: string,
    entry: StoredWorkspacePaneTabsEntry,
  ): boolean {
    const prefix = `${String(input.userId)}\0${input.scope}\0`
    return key.startsWith(prefix) && entry.worktreePath === input.worktreePath
  }
}

export function createWorkspacePaneTabsRuntime<TUser extends string | number>(): WorkspacePaneTabsRuntime<TUser> {
  return new WorkspacePaneTabsRuntime<TUser>()
}

function normalizeWorkspacePaneTabs(
  tabs: readonly WorkspacePaneTabEntry[],
  context: { hasWorktree: boolean },
): WorkspacePaneTabEntry[] {
  const next: WorkspacePaneTabEntry[] = []
  const seen = new Set<string>()
  for (const entry of tabs) {
    if (!context.hasWorktree && workspacePaneTabRequiresWorktree(entry.type)) continue
    const normalized =
      entry.type === 'terminal' ? workspacePaneTerminalTabEntry(entry.terminalSessionId) : workspacePaneStaticTabEntry(entry.type)
    const identity = workspacePaneTabEntryIdentity(normalized)
    if (seen.has(identity)) continue
    seen.add(identity)
    next.push(normalized)
  }
  return next
}
