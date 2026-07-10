import PQueue from 'p-queue'
import type { WorkspacePaneRuntimeTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { isWorkspacePaneStaticTabType, workspacePaneTabsWithRuntimeTab } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsSnapshot, WorkspacePaneTabsUpdateOperation } from '#/shared/workspace-pane-tabs.ts'
import { workspacePaneTabsUserScopeQueueKey } from '#/server/workspace-pane/workspace-pane-tabs-user-queue-key.ts'
import type { WorkspacePaneTabsRuntime } from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import type {
  PhysicalWorktreeOperationCoordinator,
  PhysicalWorktreeOperationPermit,
} from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import { workspacePaneTabsWithUpdateOperation } from '#/server/workspace-pane/workspace-pane-tabs-operations.ts'
import {
  canonicalWorkspaceRuntimeTabsForTarget,
  projectWorkspaceRuntimeTabsFromProviderSnapshots,
  type WorkspacePaneRuntimeTabsProviderSnapshot,
  workspaceRuntimeTabWorktreePaths,
} from '#/server/workspace-pane/workspace-pane-runtime-tabs-projection.ts'

type WorkspacePaneTabsCoordinatorRuntime = Pick<
  WorkspacePaneTabsRuntime<string>,
  | 'closeTabsForScope'
  | 'closeTabsForWorktree'
  | 'physicalWorktreeScopes'
  | 'replaceTabs'
  | 'releaseRevisionForScope'
  | 'revision'
  | 'scopesForUser'
  | 'tabs'
  | 'tabsForScope'
>

export interface WorkspacePaneRuntimeTabsLiveSession {
  sessionId: string
  branch: string
  worktreePath: string
}

export interface WorkspacePaneRuntimeTabsProvider {
  type: WorkspacePaneRuntimeTabType
  listSessionsForUser(userId: string, scope: string): Promise<WorkspacePaneRuntimeTabsLiveSession[]>
}

interface WorkspacePaneTabsCoordinatorOptions {
  runtimeProviders: readonly WorkspacePaneRuntimeTabsProvider[]
  workspaceTabs: WorkspacePaneTabsCoordinatorRuntime
  worktreeOperations: PhysicalWorktreeOperationCoordinator
}

export class WorkspacePaneTabsCoordinator {
  private readonly runtimeProviders: readonly WorkspacePaneRuntimeTabsProvider[]
  private readonly workspaceTabs: WorkspacePaneTabsCoordinatorRuntime
  private readonly worktreeOperations: PhysicalWorktreeOperationCoordinator
  private readonly operationQueuesByScope = new Map<string, PQueue>()

  constructor(options: WorkspacePaneTabsCoordinatorOptions) {
    this.runtimeProviders = options.runtimeProviders
    this.workspaceTabs = options.workspaceTabs
    this.worktreeOperations = options.worktreeOperations
  }

  async ensureRuntimeTabForSession<TFailure>(input: {
    userId: string
    repoRoot: string
    scope: string
    branchName: string
    worktreePath: string
    runtimeType: WorkspacePaneRuntimeTabType
    sessionId: string
    insertAfterIdentity?: string | null
    permit: PhysicalWorktreeOperationPermit
    guardBeforeWrite?: () => TFailure | null
  }): Promise<WorkspacePaneTabsSnapshot | TFailure> {
    const target = {
      userId: input.userId,
      scope: input.scope,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
    }
    return await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, async () => {
      this.worktreeOperations.assertPermit(input, input.permit)
      const providerSnapshots = await this.runtimeProviderSnapshotsForWorktree(
        input.userId,
        input.scope,
        input.worktreePath,
      )
      const failure = input.guardBeforeWrite?.() ?? null
      if (failure) return failure
      this.worktreeOperations.assertPermit(input, input.permit)
      const proposedTabs = workspacePaneTabsWithRuntimeTab(
        this.workspaceTabs.tabs(target),
        input.runtimeType,
        input.sessionId,
        { insertAfterIdentity: input.insertAfterIdentity ?? null },
      )
      this.workspaceTabs.replaceTabs({
        ...target,
        tabs: canonicalWorkspaceRuntimeTabsForTarget({
          entry: {
            branchName: input.branchName,
            worktreePath: input.worktreePath,
            tabs: proposedTabs,
          },
          providerSnapshots,
        }),
      })
      return this.scopeSnapshot(input.userId, input.repoRoot, input.scope)
    })
  }

  async replaceTabs(input: {
    userId: string
    repoRoot: string
    scope: string
    branchName: string
    worktreePath: string | null
    tabs: readonly WorkspacePaneTabEntry[]
    assertCurrent: () => void
  }): Promise<WorkspacePaneTabsSnapshot> {
    const operation = async () =>
      await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, async () => {
        input.assertCurrent()
        const tabs = await this.canonicalRuntimeTabsForTarget(input)
        input.assertCurrent()
        this.workspaceTabs.replaceTabs({
          userId: input.userId,
          scope: input.scope,
          branchName: input.branchName,
          worktreePath: input.worktreePath,
          tabs,
        })
        return this.scopeSnapshot(input.userId, input.repoRoot, input.scope)
      })
    if (input.worktreePath === null) return await operation()
    const result = await this.worktreeOperations.runOperation(
      { repoRoot: input.repoRoot, worktreePath: input.worktreePath },
      operation,
    )
    if (!result.admitted) throw new Error('error.worktree-removal-in-progress')
    return result.value
  }

  async updateTabs(input: {
    userId: string
    repoRoot: string
    scope: string
    branchName: string
    worktreePath: string | null
    operation: WorkspacePaneTabsUpdateOperation
    assertCurrent: () => void
  }): Promise<WorkspacePaneTabsSnapshot> {
    const operation = async () =>
      await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, async () => {
        input.assertCurrent()
        const target = {
          userId: input.userId,
          scope: input.scope,
          branchName: input.branchName,
          worktreePath: input.worktreePath,
        }
        const updatedTabs = workspacePaneTabsWithUpdateOperation(this.workspaceTabs.tabs(target), input.operation)
        const tabs = await this.canonicalRuntimeTabsForTarget({ ...input, tabs: updatedTabs })
        input.assertCurrent()
        this.workspaceTabs.replaceTabs({ ...target, tabs })
        return this.scopeSnapshot(input.userId, input.repoRoot, input.scope)
      })
    if (input.worktreePath === null) return await operation()
    const result = await this.worktreeOperations.runOperation(
      { repoRoot: input.repoRoot, worktreePath: input.worktreePath },
      operation,
    )
    if (!result.admitted) throw new Error('error.worktree-removal-in-progress')
    return result.value
  }

  async reconcileWorktree(input: {
    userId: string
    repoRoot: string
    scope: string
    worktreePath: string
    assertCurrent?: () => void
  }): Promise<WorkspacePaneTabsSnapshot> {
    return await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, async () => {
      const providerSnapshots = await this.runtimeProviderSnapshotsForWorktree(
        input.userId,
        input.scope,
        input.worktreePath,
      )
      input.assertCurrent?.()
      const replacements = projectWorkspaceRuntimeTabsFromProviderSnapshots({
        entries: this.workspaceTabs
          .tabsForScope({ userId: input.userId, scope: input.scope })
          .filter((entry) => entry.worktreePath === input.worktreePath),
        providerSnapshots,
        worktreePath: input.worktreePath,
      })
      input.assertCurrent?.()
      for (const replacement of replacements) {
        this.workspaceTabs.replaceTabs({
          userId: input.userId,
          scope: input.scope,
          branchName: replacement.branchName,
          worktreePath: replacement.worktreePath,
          tabs: replacement.tabs,
        })
      }
      return this.scopeSnapshot(input.userId, input.repoRoot, input.scope)
    })
  }

  async listWorkspaceTabs(input: {
    userId: string
    repoRoot: string
    scope: string
    assertCurrent: () => void
    broadcastChanged: () => void
  }): Promise<WorkspacePaneTabsSnapshot> {
    return await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, async () => {
      const revisionBeforeReconcile = this.workspaceTabs.revision(input)
      await this.reconcileWorkspaceTabsProjectionBoundary(input)
      if (this.workspaceTabs.revision(input) !== revisionBeforeReconcile) input.broadcastChanged()
      return this.scopeSnapshot(input.userId, input.repoRoot, input.scope)
    })
  }

  async snapshot(input: { userId: string; repoRoot: string; scope: string }): Promise<WorkspacePaneTabsSnapshot> {
    return await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, () =>
      this.scopeSnapshot(input.userId, input.repoRoot, input.scope),
    )
  }

  async closeScope(input: { userId: string; scope: string }): Promise<void> {
    await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, () => {
      this.workspaceTabs.closeTabsForScope(input.userId, input.scope)
    })
  }

  async closeInvalidatedScope(input: { userId: string; scope: string }): Promise<void> {
    await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, () => {
      this.workspaceTabs.closeTabsForScope(input.userId, input.scope)
      this.workspaceTabs.releaseRevisionForScope(input.userId, input.scope)
    })
  }

  physicalWorktreeScopes(input: { repoRoot: string; worktreePath: string }): Array<{ userId: string; scope: string }> {
    return this.workspaceTabs.physicalWorktreeScopes(input)
  }

  async finalizePhysicalWorktreeRemoval(input: {
    worktreePath: string
    scopes: readonly { userId: string; scope: string }[]
  }): Promise<void> {
    await Promise.all(
      input.scopes.map(async ({ userId, scope }) => {
        await this.runWorkspaceTabsScopeOperation(userId, scope, () => {
          this.workspaceTabs.closeTabsForWorktree({ userId, scope, worktreePath: input.worktreePath })
        })
      }),
    )
  }

  async reconcilePhysicalWorktreeAfterRemovalFailure(input: {
    repoRoot: string
    worktreePath: string
    scopes: readonly { userId: string; scope: string }[]
  }): Promise<void> {
    await Promise.all(
      input.scopes.map(async ({ userId, scope }) => {
        await this.reconcileWorktree({
          userId,
          repoRoot: input.repoRoot,
          scope,
          worktreePath: input.worktreePath,
        })
      }),
    )
  }

  async closeUser(input: { userId: string }): Promise<void> {
    for (;;) {
      const scopes = this.workspaceTabs.scopesForUser(input.userId)
      if (scopes.length === 0) return
      await Promise.all(scopes.map(async (scope) => await this.closeScope({ userId: input.userId, scope })))
    }
  }

  private async canonicalRuntimeTabsForTarget(input: {
    userId: string
    scope: string
    branchName: string
    worktreePath: string | null
    tabs: readonly WorkspacePaneTabEntry[]
  }): Promise<WorkspacePaneTabEntry[]> {
    return canonicalWorkspaceRuntimeTabsForTarget({
      entry: {
        branchName: input.branchName,
        worktreePath: input.worktreePath,
        tabs: input.tabs,
      },
      providerSnapshots: await this.runtimeProviderSnapshotsForTarget(input),
    })
  }

  private async runtimeProviderSnapshotsForTarget(input: {
    userId: string
    scope: string
    worktreePath: string | null
  }): Promise<WorkspacePaneRuntimeTabsProviderSnapshot[]> {
    if (input.worktreePath === null) {
      return this.runtimeProviders.map((provider) => ({ type: provider.type, liveSessions: [] }))
    }
    return await this.runtimeProviderSnapshotsForWorktree(input.userId, input.scope, input.worktreePath)
  }

  private async runtimeProviderSnapshotsForWorktree(
    userId: string,
    scope: string,
    worktreePath: string,
  ): Promise<WorkspacePaneRuntimeTabsProviderSnapshot[]> {
    return await Promise.all(
      this.runtimeProviders.map(async (provider) => ({
        type: provider.type,
        liveSessions: (await provider.listSessionsForUser(userId, scope)).filter(
          (session) => session.worktreePath === worktreePath,
        ),
      })),
    )
  }

  private async runtimeProviderSnapshotsForScope(
    userId: string,
    scope: string,
  ): Promise<WorkspacePaneRuntimeTabsProviderSnapshot[]> {
    return await Promise.all(
      this.runtimeProviders.map(async (provider) => ({
        type: provider.type,
        liveSessions: await provider.listSessionsForUser(userId, scope),
      })),
    )
  }

  private async reconcileWorkspaceTabsProjectionBoundary(input: {
    userId: string
    repoRoot: string
    scope: string
    assertCurrent: () => void
  }): Promise<void> {
    const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
    input.assertCurrent()
    const scopeEntries = this.workspaceTabs.tabsForScope({ userId: input.userId, scope: input.scope })
    const worktreePaths = workspaceRuntimeTabWorktreePaths({ entries: scopeEntries, providerSnapshots })
    const replacementGroups = worktreePaths.map((worktreePath) =>
      projectWorkspaceRuntimeTabsFromProviderSnapshots({
        entries: scopeEntries.filter((entry) => entry.worktreePath === worktreePath),
        providerSnapshots,
        worktreePath,
      }),
    )
    const replacements = replacementGroups.flat()
    // Read-side canonicalization boundary: runtime tabs are a projection of
    // server-owned live sessions. Listing tabs self-heals missing runtime
    // entries so reload/restore always returns a coherent tab strip.
    input.assertCurrent()
    for (const replacement of replacements) {
      this.workspaceTabs.replaceTabs({
        userId: input.userId,
        scope: input.scope,
        branchName: replacement.branchName,
        worktreePath: replacement.worktreePath,
        tabs: replacement.tabs,
      })
    }
  }

  private scopeSnapshot(userId: string, repoRoot: string, scope: string): WorkspacePaneTabsSnapshot {
    return {
      revision: this.workspaceTabs.revision({ userId, scope }),
      entries: this.workspaceTabs.tabsForScope({ userId, scope }).map((entry) => ({
        repoRoot,
        branchName: entry.branchName,
        worktreePath: entry.worktreePath,
        tabs: entry.tabs,
      })),
    }
  }

  private async runWorkspaceTabsScopeOperation<T>(
    userId: string,
    scope: string,
    task: () => Promise<T> | T,
  ): Promise<T> {
    return await this.runWorkspaceTabsOperationByKey(workspacePaneTabsUserScopeQueueKey(userId, scope), task)
  }

  private async runWorkspaceTabsOperationByKey<T>(queueKey: string, task: () => Promise<T> | T): Promise<T> {
    const queue = this.workspaceTabsOperationQueue(queueKey)
    try {
      return await queue.add(task)
    } finally {
      this.scheduleWorkspaceTabsOperationQueueCleanup(queueKey, queue)
    }
  }

  private workspaceTabsOperationQueue(queueKey: string): PQueue {
    let queue = this.operationQueuesByScope.get(queueKey)
    if (!queue) {
      queue = new PQueue({ concurrency: 1 })
      this.operationQueuesByScope.set(queueKey, queue)
    }
    return queue
  }

  private scheduleWorkspaceTabsOperationQueueCleanup(queueKey: string, queue: PQueue): void {
    void queue.onIdle().then(() => {
      if (this.operationQueuesByScope.get(queueKey) !== queue) return
      if (queue.size === 0 && queue.pending === 0) this.operationQueuesByScope.delete(queueKey)
    })
  }
}

export function createWorkspacePaneTabsCoordinator(
  options: WorkspacePaneTabsCoordinatorOptions,
): WorkspacePaneTabsCoordinator {
  return new WorkspacePaneTabsCoordinator(options)
}

export function isValidWorkspacePaneTabsOperation(value: unknown): value is WorkspacePaneTabsUpdateOperation {
  if (!value || typeof value !== 'object') return false
  const operation = value as {
    type?: unknown
    tabType?: unknown
    tabIdentities?: unknown
    insertAfterIdentity?: unknown
  }
  if (operation.type === 'open-static') {
    return (
      typeof operation.tabType === 'string' &&
      isWorkspacePaneStaticTabType(operation.tabType) &&
      (operation.insertAfterIdentity === undefined ||
        operation.insertAfterIdentity === null ||
        (typeof operation.insertAfterIdentity === 'string' &&
          operation.insertAfterIdentity.length > 0 &&
          !operation.insertAfterIdentity.includes('\0')))
    )
  }
  if (operation.type === 'close-static') {
    return typeof operation.tabType === 'string' && isWorkspacePaneStaticTabType(operation.tabType)
  }
  if (operation.type === 'reorder') {
    return (
      Array.isArray(operation.tabIdentities) &&
      operation.tabIdentities.every(
        (identity) => typeof identity === 'string' && identity.length > 0 && !identity.includes('\0'),
      )
    )
  }
  return false
}
