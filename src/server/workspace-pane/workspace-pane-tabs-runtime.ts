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
import type { WorkspacePaneTabsEntry, WorkspacePaneTabsUpdateOperation } from '#/shared/workspace-pane-tabs.ts'
import type { WorkspacePaneTabsTargetIdentity } from '#/shared/workspace-pane-tabs-target.ts'
import {
  workspacePaneTabsRuntimeKey,
  workspacePaneTabsRuntimeScopePrefixKey,
  workspacePaneTabsRuntimeUserPrefixKey,
} from '#/shared/workspace-pane-tabs-runtime-keys.ts'
import {
  workspacePaneTabsUserQueuePrefixKey,
  workspacePaneTabsUserScopeQueueKey,
} from '#/server/workspace-pane/workspace-pane-tabs-user-queue-key.ts'
import {
  workspacePaneTabEntryArraysEqual,
  workspacePaneTabsWithUpdateOperation,
} from '#/server/workspace-pane/workspace-pane-tabs-operations.ts'
import {
  physicalWorktreeIdentityKey,
  type PhysicalWorktreeIdentity,
} from '#/server/worktree-removal/physical-worktree-identity.ts'

export interface WorkspacePaneTabsTargetInput<TUser extends string | number> {
  userId: TUser
  scope: string
  branchName: string
  worktreePath: string | null
}

export interface WorkspacePaneTabsReplaceInput<
  TUser extends string | number,
> extends WorkspacePaneTabsTargetInput<TUser> {
  repoRoot: string
  tabs: readonly WorkspacePaneTabEntry[]
  physicalWorktreeIdentity: PhysicalWorktreeIdentity | null
}

export interface WorkspacePaneTabsUpdatePlanInput<TUser extends string | number> extends Omit<
  WorkspacePaneTabsReplaceInput<TUser>,
  'tabs'
> {
  currentTabs: readonly WorkspacePaneTabEntry[]
  operation: WorkspacePaneTabsUpdateOperation
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
  repoRoot: string
  scope: string
  branchName: string
  worktreePath: string | null
  physicalWorktreeKey: string | null
  tabs: WorkspacePaneTabEntry[]
}

interface WorkspacePaneTabsMutationPlanState<TUser extends string | number> {
  userId: TUser
  scope: string
  expectedRevision: number
  entries: readonly StoredWorkspacePaneTabsEntry<TUser>[]
  changed: boolean
  resultTabs: readonly WorkspacePaneTabEntry[]
}

const WORKSPACE_PANE_TABS_PLAN_STATE: unique symbol = Symbol('workspace-pane-tabs-plan-state')

export interface WorkspacePaneTabsMutationPlan<TUser extends string | number> {
  readonly [WORKSPACE_PANE_TABS_PLAN_STATE]: WorkspacePaneTabsMutationPlanState<TUser>
}

export interface WorkspacePanePhysicalWorktreeTarget<TUser extends string | number> {
  userId: TUser
  scope: string
  target: Extract<WorkspacePaneTabsTargetIdentity, { kind: 'worktree' }>
}

const DEFAULT_WORKSPACE_TABS: readonly WorkspacePaneTabEntry[] = [workspacePaneStaticTabEntry('status')]

export class WorkspacePaneTabsRuntime<TUser extends string | number> {
  // Authoritative layout intent. Runtime entries are ordering hints only;
  // provider snapshots remain the sole live-runtime membership authority.
  private readonly tabsByTarget = new Map<string, StoredWorkspacePaneTabsEntry<TUser>>()
  private readonly revisionByUserScope = new Map<string, number>()
  private readonly initializedScopes = new Set<string>()

  planReplace(input: WorkspacePaneTabsReplaceInput<TUser>): WorkspacePaneTabsMutationPlan<TUser> {
    return this.planTargetReplacement(input)
  }

  planUpdate(input: WorkspacePaneTabsUpdatePlanInput<TUser>): WorkspacePaneTabsMutationPlan<TUser> {
    return this.planTargetReplacement({
      ...input,
      tabs: workspacePaneTabsWithUpdateOperation(input.currentTabs, input.operation),
    })
  }

  planRetire(
    input: WorkspacePaneTabsScopeInput<TUser> & { target: WorkspacePaneTabsTargetIdentity },
  ): WorkspacePaneTabsMutationPlan<TUser> {
    const entries = this.storedEntriesForScope(input)
    assertWorkspacePaneScopeRepoRoot(entries, input.target.repoRoot)
    const nextEntries = entries.filter((entry) => !workspacePaneEntryMatchesTarget(entry, input.target))
    return workspacePaneTabsMutationPlan({
      userId: input.userId,
      scope: input.scope,
      expectedRevision: this.revision(input),
      entries: nextEntries,
      changed: nextEntries.length !== entries.length,
      resultTabs: [],
    })
  }

  commitPlan(plan: WorkspacePaneTabsMutationPlan<TUser>): WorkspacePaneTabEntry[] {
    const state = workspacePaneTabsMutationPlanState(plan)
    if (this.revision(state) !== state.expectedRevision) throw new Error('error.workspace-tabs-plan-stale')
    if (!state.changed) return [...state.resultTabs]
    const prefix = workspacePaneTabsRuntimeScopePrefixKey(state.userId, state.scope)
    for (const key of Array.from(this.tabsByTarget.keys())) {
      if (key.startsWith(prefix)) this.tabsByTarget.delete(key)
    }
    for (const entry of state.entries) this.tabsByTarget.set(this.targetKey(entry), cloneStoredEntry(entry))
    this.initializedScopes.add(workspacePaneTabsUserScopeQueueKey(state.userId, state.scope))
    this.advanceRevision(state.userId, state.scope)
    return [...state.resultTabs]
  }

  scopeEntriesForPlan(plan: WorkspacePaneTabsMutationPlan<TUser>): WorkspacePaneTabsEntry[] {
    const state = workspacePaneTabsMutationPlanState(plan)
    return state.entries.map((entry) => ({
      repoRoot: entry.repoRoot,
      branchName: entry.branchName,
      worktreePath: entry.worktreePath,
      tabs: [...entry.tabs],
    }))
  }

  private planTargetReplacement(input: WorkspacePaneTabsReplaceInput<TUser>): WorkspacePaneTabsMutationPlan<TUser> {
    if (input.worktreePath !== null && input.physicalWorktreeIdentity === null) {
      throw new Error('error.invalid-worktree-identity')
    }
    const targetKey = this.targetKey(input)
    const tabs = normalizeWorkspacePaneTabs(input.tabs, { hasWorktree: input.worktreePath !== null })
    const physicalWorktreeKey =
      input.worktreePath === null ? null : physicalWorktreeIdentityKey(input.physicalWorktreeIdentity!)
    const entries = this.storedEntriesForScope(input)
    assertWorkspacePaneScopeRepoRoot(entries, input.repoRoot)
    const existing = entries.find((entry) => this.targetKey(entry) === targetKey)
    const changed = !(
      existing &&
      existing.repoRoot === input.repoRoot &&
      existing.branchName === input.branchName &&
      existing.worktreePath === input.worktreePath &&
      existing.physicalWorktreeKey === physicalWorktreeKey &&
      workspacePaneTabEntryArraysEqual(existing.tabs, tabs)
    )
    const replacement: StoredWorkspacePaneTabsEntry<TUser> = {
      userId: input.userId,
      repoRoot: input.repoRoot,
      scope: input.scope,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      physicalWorktreeKey,
      tabs,
    }
    return workspacePaneTabsMutationPlan({
      userId: input.userId,
      scope: input.scope,
      expectedRevision: this.revision(input),
      entries: changed
        ? existing
          ? entries.map((entry) => (this.targetKey(entry) === targetKey ? replacement : entry))
          : [...entries, replacement]
        : entries,
      changed,
      resultTabs: tabs,
    })
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

  isScopeInitialized(input: WorkspacePaneTabsScopeInput<TUser>): boolean {
    return this.initializedScopes.has(workspacePaneTabsUserScopeQueueKey(input.userId, input.scope))
  }

  initializeScope(input: WorkspacePaneTabsScopeInput<TUser>): void {
    this.initializedScopes.add(workspacePaneTabsUserScopeQueueKey(input.userId, input.scope))
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
    this.initializedScopes.delete(workspacePaneTabsUserScopeQueueKey(userId, scope))
  }

  /** Releases a clock only after the owning repo-runtime epoch is invalid. */
  releaseRevisionForScope(userId: TUser, scope: string): void {
    if (this.tabsForScope({ userId, scope }).length > 0) {
      throw new Error('cannot release workspace pane tabs revision with live targets')
    }
    this.revisionByUserScope.delete(workspacePaneTabsUserScopeQueueKey(userId, scope))
  }

  physicalWorktreeTargets(identity: PhysicalWorktreeIdentity): WorkspacePanePhysicalWorktreeTarget<TUser>[] {
    const targetKey = physicalWorktreeIdentityKey(identity)
    const affected = new Map<string, WorkspacePanePhysicalWorktreeTarget<TUser>>()
    for (const entry of this.tabsByTarget.values()) {
      if (entry.physicalWorktreeKey !== targetKey) continue
      const target = { kind: 'worktree' as const, repoRoot: entry.repoRoot, worktreePath: entry.worktreePath! }
      affected.set(this.targetKey(entry), { userId: entry.userId, scope: entry.scope, target })
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
    const initializedPrefix = workspacePaneTabsUserQueuePrefixKey(userId)
    for (const key of this.initializedScopes) {
      if (key.startsWith(initializedPrefix)) scopes.add(key.slice(initializedPrefix.length))
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

  private storedEntriesForScope(input: WorkspacePaneTabsScopeInput<TUser>): StoredWorkspacePaneTabsEntry<TUser>[] {
    const prefix = workspacePaneTabsRuntimeScopePrefixKey(input.userId, input.scope)
    return Array.from(this.tabsByTarget.entries()).flatMap(([key, entry]) =>
      key.startsWith(prefix) ? [cloneStoredEntry(entry)] : [],
    )
  }

  private advanceRevision(userId: TUser, scope: string): void {
    const key = workspacePaneTabsUserScopeQueueKey(userId, scope)
    this.revisionByUserScope.set(key, (this.revisionByUserScope.get(key) ?? 0) + 1)
  }
}

function cloneStoredEntry<TUser extends string | number>(
  entry: StoredWorkspacePaneTabsEntry<TUser>,
): StoredWorkspacePaneTabsEntry<TUser> {
  return { ...entry, tabs: [...entry.tabs] }
}

function workspacePaneTabsMutationPlan<TUser extends string | number>(
  state: WorkspacePaneTabsMutationPlanState<TUser>,
): WorkspacePaneTabsMutationPlan<TUser> {
  return { [WORKSPACE_PANE_TABS_PLAN_STATE]: state }
}

function workspacePaneTabsMutationPlanState<TUser extends string | number>(
  plan: WorkspacePaneTabsMutationPlan<TUser>,
): WorkspacePaneTabsMutationPlanState<TUser> {
  return plan[WORKSPACE_PANE_TABS_PLAN_STATE]
}

function workspacePaneEntryMatchesTarget<TUser extends string | number>(
  entry: StoredWorkspacePaneTabsEntry<TUser>,
  target: WorkspacePaneTabsTargetIdentity,
): boolean {
  if (entry.repoRoot !== target.repoRoot) return false
  return target.kind === 'branch'
    ? entry.worktreePath === null && entry.branchName === target.branchName
    : entry.worktreePath === target.worktreePath
}

function assertWorkspacePaneScopeRepoRoot<TUser extends string | number>(
  entries: readonly StoredWorkspacePaneTabsEntry<TUser>[],
  repoRoot: string,
): void {
  if (entries.some((entry) => entry.repoRoot !== repoRoot)) {
    throw new Error('error.workspace-tabs-scope-repo-mismatch')
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
