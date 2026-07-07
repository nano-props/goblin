import {
  isWorkspacePaneRuntimeTabEntry,
  type WorkspacePaneRuntimeTabType,
  type WorkspacePaneStaticTabType,
  type WorkspacePaneTabEntry,
  workspacePaneRuntimeTabEntry,
  workspacePaneRuntimeTabSessionId,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
  workspacePaneTabRequiresWorktree,
} from '#/shared/workspace-pane.ts'
import {
  workspacePaneTabsRuntimeKey,
  workspacePaneTabsRuntimeScopePrefixKey,
  workspacePaneTabsRuntimeUserPrefixKey,
} from '#/shared/workspace-pane-tabs-runtime-keys.ts'
import {
  workspacePaneTabEntryArraysEqual,
  workspacePaneTabsWithIdentityOrder,
  workspacePaneTabsWithRuntimeTab,
  workspacePaneTabsWithoutStaticTab,
  workspacePaneTabsWithStaticTab,
} from '#/server/workspace-pane/workspace-pane-tabs-operations.ts'

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
  scope: string
  branchName: string
  worktreePath: string | null
  tabs: WorkspacePaneTabEntry[]
}

const DEFAULT_WORKSPACE_TABS: readonly WorkspacePaneTabEntry[] = [workspacePaneStaticTabEntry('status')]

export class WorkspacePaneTabsRuntime<TUser extends string | number> {
  // Authoritative in-process runtime state for workspace pane tabs.
  // Client query caches and session snapshots are projections/restore
  // inputs; they should not be treated as competing runtime owners.
  private readonly tabsByTarget = new Map<string, StoredWorkspacePaneTabsEntry>()

  replaceTabs(input: WorkspacePaneTabsReplaceInput<TUser>): WorkspacePaneTabEntry[] {
    const targetKey = this.targetKey(input)
    const tabs = normalizeWorkspacePaneTabs(input.tabs, { hasWorktree: input.worktreePath !== null })
    this.tabsByTarget.set(targetKey, {
      scope: input.scope,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      tabs,
    })
    return [...tabs]
  }

  ensureRuntimeTab(
    input: WorkspacePaneTabsTargetInput<TUser>,
    type: WorkspacePaneRuntimeTabType,
    sessionId: string,
    options?: { insertAfterIdentity?: string | null },
  ): WorkspacePaneTabEntry[] {
    const current = this.tabs(input)
    if (input.worktreePath === null || sessionId.length === 0) return current
    const tabs = workspacePaneTabsWithRuntimeTab(current, type, sessionId, options)
    return workspacePaneTabEntryArraysEqual(current, tabs) ? current : this.replaceTabs({ ...input, tabs })
  }

  openStaticTab(
    input: WorkspacePaneTabsTargetInput<TUser>,
    tabType: WorkspacePaneStaticTabType,
    options?: { insertAfterIdentity?: string | null },
  ): WorkspacePaneTabEntry[] {
    const current = this.tabs(input)
    const tabs = workspacePaneTabsWithStaticTab(current, tabType, options)
    return workspacePaneTabEntryArraysEqual(current, tabs) ? current : this.replaceTabs({ ...input, tabs })
  }

  closeStaticTab(
    input: WorkspacePaneTabsTargetInput<TUser>,
    tabType: WorkspacePaneStaticTabType,
  ): WorkspacePaneTabEntry[] {
    const current = this.tabs(input)
    const tabs = workspacePaneTabsWithoutStaticTab(current, tabType)
    return workspacePaneTabEntryArraysEqual(current, tabs) ? current : this.replaceTabs({ ...input, tabs })
  }

  reorderTabsByIdentity(
    input: WorkspacePaneTabsTargetInput<TUser>,
    tabIdentities: readonly string[],
  ): WorkspacePaneTabEntry[] {
    const current = this.tabs(input)
    const tabs = workspacePaneTabsWithIdentityOrder(current, tabIdentities)
    return workspacePaneTabEntryArraysEqual(current, tabs) ? current : this.replaceTabs({ ...input, tabs })
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

  runtimeSessionIds(input: WorkspacePaneTabsWorktreeInput<TUser>, type: WorkspacePaneRuntimeTabType): string[] {
    const entries = this.tabsForScope({ userId: input.userId, scope: input.scope }).filter(
      (entry) => entry.worktreePath === input.worktreePath,
    )
    return entries.flatMap((entry) =>
      entry.tabs.flatMap((tab) =>
        isWorkspacePaneRuntimeTabEntry(tab) && tab.type === type ? [workspacePaneRuntimeTabSessionId(tab)] : [],
      ),
    )
  }

  closeTabsForUser(userId: TUser): void {
    const prefix = workspacePaneTabsRuntimeUserPrefixKey(userId)
    for (const key of Array.from(this.tabsByTarget.keys())) {
      if (key.startsWith(prefix)) this.tabsByTarget.delete(key)
    }
  }

  closeTabsForScope(userId: TUser, scope: string): void {
    const prefix = workspacePaneTabsRuntimeScopePrefixKey(userId, scope)
    for (const key of Array.from(this.tabsByTarget.keys())) {
      if (key.startsWith(prefix)) this.tabsByTarget.delete(key)
    }
  }

  scopesForUser(userId: TUser): string[] {
    const prefix = workspacePaneTabsRuntimeUserPrefixKey(userId)
    const scopes = new Set<string>()
    for (const [key, entry] of this.tabsByTarget.entries()) {
      if (key.startsWith(prefix)) scopes.add(entry.scope)
    }
    return Array.from(scopes)
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
    const normalized = isWorkspacePaneRuntimeTabEntry(entry)
      ? workspacePaneRuntimeTabEntry(entry.type, workspacePaneRuntimeTabSessionId(entry))
      : workspacePaneStaticTabEntry(entry.type)
    const identity = workspacePaneTabEntryIdentity(normalized)
    if (seen.has(identity)) continue
    seen.add(identity)
    next.push(normalized)
  }
  return next
}
