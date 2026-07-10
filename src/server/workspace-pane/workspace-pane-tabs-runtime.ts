import {
  isWorkspacePaneRuntimeTabEntry,
  type WorkspacePaneRuntimeTabType,
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
import { workspacePaneTabsUserScopeQueueKey } from '#/server/workspace-pane/workspace-pane-tabs-user-queue-key.ts'
import { workspacePaneTabEntryArraysEqual } from '#/server/workspace-pane/workspace-pane-tabs-operations.ts'
import { terminalSessionScopeBelongsToRepo } from '#/server/terminal/terminal-session-scope.ts'

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

interface StoredWorkspacePaneTabsEntry<TUser extends string | number> {
  userId: TUser
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
  private readonly tabsByTarget = new Map<string, StoredWorkspacePaneTabsEntry<TUser>>()
  private readonly revisionByUserScope = new Map<string, number>()

  replaceTabs(input: WorkspacePaneTabsReplaceInput<TUser>): WorkspacePaneTabEntry[] {
    const targetKey = this.targetKey(input)
    const tabs = normalizeWorkspacePaneTabs(input.tabs, { hasWorktree: input.worktreePath !== null })
    const existing = this.tabsByTarget.get(targetKey)
    if (
      existing &&
      existing.branchName === input.branchName &&
      existing.worktreePath === input.worktreePath &&
      workspacePaneTabEntryArraysEqual(existing.tabs, tabs)
    ) {
      return [...existing.tabs]
    }
    this.tabsByTarget.set(targetKey, {
      userId: input.userId,
      scope: input.scope,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      tabs,
    })
    this.advanceRevision(input.userId, input.scope)
    return [...tabs]
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
    for (const scope of this.scopesForUser(userId)) this.closeTabsForScope(userId, scope)
  }

  closeTabsForScope(userId: TUser, scope: string): void {
    const prefix = workspacePaneTabsRuntimeScopePrefixKey(userId, scope)
    let changed = false
    for (const key of Array.from(this.tabsByTarget.keys())) {
      if (!key.startsWith(prefix)) continue
      this.tabsByTarget.delete(key)
      changed = true
    }
    if (changed) this.advanceRevision(userId, scope)
  }

  closeTabsForWorktree(input: WorkspacePaneTabsWorktreeInput<TUser>): void {
    const prefix = workspacePaneTabsRuntimeScopePrefixKey(input.userId, input.scope)
    let changed = false
    for (const [key, entry] of Array.from(this.tabsByTarget.entries())) {
      if (!key.startsWith(prefix) || entry.worktreePath !== input.worktreePath) continue
      this.tabsByTarget.delete(key)
      changed = true
    }
    if (changed) this.advanceRevision(input.userId, input.scope)
  }

  physicalWorktreeScopes(input: { repoRoot: string; worktreePath: string }): Array<{ userId: TUser; scope: string }> {
    const affected = new Map<string, { userId: TUser; scope: string }>()
    for (const entry of this.tabsByTarget.values()) {
      if (
        entry.worktreePath !== input.worktreePath ||
        !terminalSessionScopeBelongsToRepo(entry.scope, input.repoRoot)
      ) {
        continue
      }
      const userId = entry.userId
      affected.set(`${String(userId)}\0${entry.scope}`, { userId, scope: entry.scope })
    }
    return Array.from(affected.values())
  }

  revision(input: WorkspacePaneTabsScopeInput<TUser>): number {
    return this.revisionByUserScope.get(workspacePaneTabsUserScopeQueueKey(input.userId, input.scope)) ?? 0
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

  private advanceRevision(userId: TUser, scope: string): void {
    const key = workspacePaneTabsUserScopeQueueKey(userId, scope)
    this.revisionByUserScope.set(key, (this.revisionByUserScope.get(key) ?? 0) + 1)
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
