import {
  type WorkspacePaneStaticTabType,
  type WorkspacePaneTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
  workspacePaneTabsInsertAfterStaticTab,
  workspacePaneTabRequiresWorktree,
  workspacePaneTerminalTabEntry,
} from '#/shared/workspace-pane.ts'
import {
  workspacePaneTabsRuntimeKey,
  workspacePaneTabsRuntimeScopePrefixKey,
  workspacePaneTabsRuntimeUserPrefixKey,
} from '#/shared/workspace-pane-tabs-runtime-keys.ts'

export interface WorkspacePaneTabsTargetInput<TUser extends string | number> {
  userId: TUser
  scope: string
  branchName: string
  worktreePath: string | null
}

export interface WorkspacePaneTabsReplaceInput<
  TUser extends string | number,
> extends WorkspacePaneTabsTargetInput<TUser> {
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

  ensureTerminalTab(input: WorkspacePaneTabsTargetInput<TUser>, terminalSessionId: string): WorkspacePaneTabEntry[] {
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

  openStaticTab(
    input: WorkspacePaneTabsTargetInput<TUser>,
    tabType: WorkspacePaneStaticTabType,
    options?: { insertAfterTabType?: WorkspacePaneStaticTabType | null },
  ): WorkspacePaneTabEntry[] {
    const current = this.tabs(input)
    // Reopening an existing static tab should preserve the current user-managed
    // order and simply focus that tab on the client side.
    if (current.some((entry) => entry.type === tabType)) return current
    return this.replaceTabs({
      ...input,
      tabs: workspacePaneTabsInsertAfterStaticTab(current, workspacePaneStaticTabEntry(tabType), options?.insertAfterTabType),
    })
  }

  closeStaticTab(
    input: WorkspacePaneTabsTargetInput<TUser>,
    tabType: WorkspacePaneStaticTabType,
  ): WorkspacePaneTabEntry[] {
    return this.replaceTabs({ ...input, tabs: this.tabs(input).filter((entry) => entry.type !== tabType) })
  }

  reorderTabsByIdentity(
    input: WorkspacePaneTabsTargetInput<TUser>,
    tabIdentities: readonly string[],
  ): WorkspacePaneTabEntry[] {
    return this.replaceTabs({ ...input, tabs: workspacePaneTabsWithIdentityOrder(this.tabs(input), tabIdentities) })
  }

  tabs(input: WorkspacePaneTabsTargetInput<TUser>): WorkspacePaneTabEntry[] {
    return [...(this.tabsByTarget.get(this.targetKey(input))?.tabs ?? DEFAULT_WORKSPACE_TABS)]
  }

  tabsForScope(input: WorkspacePaneTabsScopeInput<TUser>): WorkspacePaneTabsScopeEntry[] {
    const prefix = workspacePaneTabsRuntimeScopePrefixKey(input.userId, input.scope)
    return Array.from(this.tabsByTarget.entries()).flatMap(([key, entry]) => {
      if (!key.startsWith(prefix)) return []
      return [{ branchName: entry.branchName, worktreePath: entry.worktreePath, tabs: [...entry.tabs] }]
    })
  }

  terminalSessionIds(input: WorkspacePaneTabsWorktreeInput<TUser>): string[] {
    const entries = this.tabsForScope({ userId: input.userId, scope: input.scope }).filter(
      (entry) => entry.worktreePath === input.worktreePath,
    )
    return entries.flatMap((entry) =>
      entry.tabs.flatMap((tab) => (tab.type === 'terminal' ? [tab.terminalSessionId] : [])),
    )
  }

  closeSessionsForUser(userId: TUser): void {
    const prefix = workspacePaneTabsRuntimeUserPrefixKey(userId)
    for (const key of Array.from(this.tabsByTarget.keys())) {
      if (key.startsWith(prefix)) this.tabsByTarget.delete(key)
    }
  }

  closeSessionsForScope(userId: TUser, scope: string): void {
    const prefix = workspacePaneTabsRuntimeScopePrefixKey(userId, scope)
    for (const key of Array.from(this.tabsByTarget.keys())) {
      if (key.startsWith(prefix)) this.tabsByTarget.delete(key)
    }
  }

  private targetKey(input: WorkspacePaneTabsTargetInput<TUser>): string {
    return workspacePaneTabsRuntimeKey({
      userId: input.userId,
      scope: input.scope,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
    })
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
      entry.type === 'terminal'
        ? workspacePaneTerminalTabEntry(entry.terminalSessionId)
        : workspacePaneStaticTabEntry(entry.type)
    const identity = workspacePaneTabEntryIdentity(normalized)
    if (seen.has(identity)) continue
    seen.add(identity)
    next.push(normalized)
  }
  return next
}

function workspacePaneTabsWithIdentityOrder(
  currentTabs: readonly WorkspacePaneTabEntry[],
  tabIdentities: readonly string[],
): WorkspacePaneTabEntry[] {
  const tabByIdentity = new Map(currentTabs.map((tab) => [workspacePaneTabEntryIdentity(tab), tab]))
  const used = new Set<string>()
  const ordered: WorkspacePaneTabEntry[] = []
  for (const identity of tabIdentities) {
    const tab = tabByIdentity.get(identity)
    if (!tab || used.has(identity)) continue
    used.add(identity)
    ordered.push(tab)
  }
  for (const tab of currentTabs) {
    const identity = workspacePaneTabEntryIdentity(tab)
    if (used.has(identity)) continue
    used.add(identity)
    ordered.push(tab)
  }
  return ordered
}
