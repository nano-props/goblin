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
import type { PhysicalWorktreeIdentity } from '#/server/worktree-removal/physical-worktree-identity.ts'
import type {
  PhysicalWorktreeCapability,
  PhysicalWorktreeIdentityResolver,
} from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import { workspacePaneTabsWithUpdateOperation } from '#/server/workspace-pane/workspace-pane-tabs-operations.ts'
import {
  canonicalWorkspaceRuntimeTabsForTarget,
  projectCanonicalWorkspacePaneTabs,
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
  physicalWorktrees: Pick<PhysicalWorktreeIdentityResolver, 'capture'>
}

export class WorkspacePaneTabsCoordinator {
  private readonly runtimeProviders: readonly WorkspacePaneRuntimeTabsProvider[]
  private readonly workspaceTabs: WorkspacePaneTabsCoordinatorRuntime
  private readonly worktreeOperations: PhysicalWorktreeOperationCoordinator
  private readonly physicalWorktrees: Pick<PhysicalWorktreeIdentityResolver, 'capture'>
  private readonly operationQueuesByScope = new Map<string, PQueue>()

  constructor(options: WorkspacePaneTabsCoordinatorOptions) {
    this.runtimeProviders = options.runtimeProviders
    this.workspaceTabs = options.workspaceTabs
    this.worktreeOperations = options.worktreeOperations
    this.physicalWorktrees = options.physicalWorktrees
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
    physicalWorktreeCapability: PhysicalWorktreeCapability
    guardBeforeWrite?: () => TFailure | null
  }): Promise<WorkspacePaneTabsSnapshot | TFailure> {
    const target = {
      userId: input.userId,
      scope: input.scope,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
    }
    const physicalCapability = input.physicalWorktreeCapability
    return await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, async () => {
      this.worktreeOperations.assertPermit(physicalCapability, input.permit)
      const providerSnapshots = await this.runtimeProviderSnapshotsForWorktree(
        input.userId,
        input.scope,
        input.worktreePath,
      )
      const failure = input.guardBeforeWrite?.() ?? null
      if (failure) return failure
      this.worktreeOperations.assertPermit(physicalCapability, input.permit)
      const proposedTabs = workspacePaneTabsWithRuntimeTab(
        this.workspaceTabs.tabs(target),
        input.runtimeType,
        input.sessionId,
        { insertAfterIdentity: input.insertAfterIdentity ?? null },
      )
      this.workspaceTabs.replaceTabs({
        ...target,
        physicalWorktreeIdentity: physicalCapability.identity,
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
    let physicalCapability: PhysicalWorktreeCapability | null = null
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
          physicalWorktreeIdentity: physicalCapability?.identity ?? null,
          tabs: input.tabs,
        })
        return this.scopeSnapshotWithTargetTabs(
          input.userId, input.repoRoot, input.scope, input,
          input.worktreePath === null ? this.workspaceTabs.tabs(input) : tabs,
        )
      })
    if (input.worktreePath === null) return await operation()
    physicalCapability = await this.capturePhysicalWorktree(input, input.worktreePath)
    const result = await this.worktreeOperations.runOperation(physicalCapability, operation)
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
    let physicalCapability: PhysicalWorktreeCapability | null = null
    const operation = async () =>
      await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, async () => {
        input.assertCurrent()
        const target = {
          userId: input.userId,
          scope: input.scope,
          branchName: input.branchName,
          worktreePath: input.worktreePath,
        }
        const providerSnapshots = await this.runtimeProviderSnapshotsForTarget(input)
        input.assertCurrent()
        const currentTabs = canonicalWorkspaceRuntimeTabsForTarget({
          entry: { branchName: input.branchName, worktreePath: input.worktreePath, tabs: this.workspaceTabs.tabs(target) },
          providerSnapshots,
        })
        const updatedTabs = workspacePaneTabsWithUpdateOperation(currentTabs, input.operation)
        const tabs = canonicalWorkspaceRuntimeTabsForTarget({
          entry: { branchName: input.branchName, worktreePath: input.worktreePath, tabs: updatedTabs },
          providerSnapshots,
        })
        input.assertCurrent()
        this.workspaceTabs.replaceTabs({
          ...target,
          physicalWorktreeIdentity: physicalCapability?.identity ?? null,
          tabs: updatedTabs,
        })
        return this.scopeSnapshotWithTargetTabs(
          input.userId, input.repoRoot, input.scope, input,
          input.worktreePath === null ? this.workspaceTabs.tabs(input) : tabs,
        )
      })
    if (input.worktreePath === null) return await operation()
    physicalCapability = await this.capturePhysicalWorktree(input, input.worktreePath)
    const result = await this.worktreeOperations.runOperation(physicalCapability, operation)
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
    const capability = await this.capturePhysicalWorktree(input, input.worktreePath)
    const result = await this.worktreeOperations.runOperation(capability, async (permit) =>
      await this.reconcileWorktreeAdmitted({ ...input, physicalWorktreeCapability: capability, permit }),
    )
    if (!result.admitted) throw new Error('error.worktree-removal-in-progress')
    return result.value
  }

  async reconcileWorktreeAdmitted(input: {
    userId: string
    repoRoot: string
    scope: string
    worktreePath: string
    physicalWorktreeCapability: PhysicalWorktreeCapability
    permit: PhysicalWorktreeOperationPermit
    assertCurrent?: () => void
  }): Promise<WorkspacePaneTabsSnapshot> {
    this.worktreeOperations.assertPermit(input.physicalWorktreeCapability, input.permit)
    return await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, async () => {
      const providerSnapshots = await this.runtimeProviderSnapshotsForWorktree(
        input.userId,
        input.scope,
        input.worktreePath,
      )
      input.assertCurrent?.()
      this.worktreeOperations.assertPermit(input.physicalWorktreeCapability, input.permit)
      input.assertCurrent?.()
      return this.projectedScopeSnapshot(input.userId, input.repoRoot, input.scope, providerSnapshots)
    })
  }

  async listWorkspaceTabs(input: {
    userId: string
    repoRoot: string
    scope: string
    assertCurrent: () => void
  }): Promise<WorkspacePaneTabsSnapshot> {
    return await this.reconcileWorkspaceTabsProjectionBoundary(input)
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

  physicalWorktreeScopes(identity: PhysicalWorktreeIdentity): Array<{ userId: string; scope: string }> {
    return this.workspaceTabs.physicalWorktreeScopes(identity)
  }

  async finalizePhysicalWorktreeRemoval(input: {
    worktreePath: string
    physicalWorktreeCapability: PhysicalWorktreeCapability
    permit: PhysicalWorktreeOperationPermit
    scopes: readonly { userId: string; scope: string }[]
  }): Promise<void> {
    this.worktreeOperations.assertPermit(input.physicalWorktreeCapability, input.permit)
    await Promise.all(
      input.scopes.map(async ({ userId, scope }) => {
        await this.runWorkspaceTabsScopeOperation(userId, scope, () => {
          this.workspaceTabs.closeTabsForWorktree({
            userId,
            scope,
            worktreePath: input.worktreePath,
            identity: input.physicalWorktreeCapability.identity,
          })
        })
      }),
    )
  }

  async reconcilePhysicalWorktreeAfterRemovalFailure(input: {
    repoRoot: string
    worktreePath: string
    physicalWorktreeCapability: PhysicalWorktreeCapability
    permit: PhysicalWorktreeOperationPermit
    scopes: readonly { userId: string; scope: string }[]
  }): Promise<void> {
    await Promise.all(
      input.scopes.map(async ({ userId, scope }) => {
        await this.reconcileWorktreeAdmitted({
          userId,
          repoRoot: input.repoRoot,
          scope,
          worktreePath: input.worktreePath,
          physicalWorktreeCapability: input.physicalWorktreeCapability,
          permit: input.permit,
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
  }): Promise<WorkspacePaneTabsSnapshot> {
    const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
    input.assertCurrent()
    const scopeEntries = this.workspaceTabs.tabsForScope({ userId: input.userId, scope: input.scope })
    const worktreePaths = workspaceRuntimeTabWorktreePaths({ entries: scopeEntries, providerSnapshots })
    // Admission is read-only: it prevents a provider snapshot from presenting
    // a worktree while its physical removal is admitted, but never writes the
    // derived membership back into layout state.
    for (const worktreePath of worktreePaths) {
      const capability = await this.capturePhysicalWorktree(input, worktreePath)
      const result = await this.worktreeOperations.runOperation(capability, async (permit) => {
        input.assertCurrent()
        this.worktreeOperations.assertPermit(capability, permit)
      })
      if (!result.admitted) throw new Error('error.worktree-removal-in-progress')
    }
    return await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, () => {
      input.assertCurrent()
      return this.projectedScopeSnapshot(input.userId, input.repoRoot, input.scope, providerSnapshots)
    })
  }

  private async capturePhysicalWorktree(
    input: { userId: string; repoRoot: string; scope: string },
    worktreePath: string,
  ): Promise<PhysicalWorktreeCapability> {
    const separator = input.scope.lastIndexOf('\0')
    const repoRuntimeId = separator >= 0 ? input.scope.slice(separator + 1) : ''
    return await this.physicalWorktrees.capture({
      userId: input.userId,
      repoRoot: input.repoRoot,
      repoRuntimeId,
      worktreePath,
    })
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

  private projectedScopeSnapshot(
    userId: string,
    repoRoot: string,
    scope: string,
    providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
  ): WorkspacePaneTabsSnapshot {
    return {
      revision: this.workspaceTabs.revision({ userId, scope }),
      entries: projectCanonicalWorkspacePaneTabs({
        entries: this.workspaceTabs.tabsForScope({ userId, scope }),
        providerSnapshots,
      }).map((entry) => ({ repoRoot, ...entry })),
    }
  }

  private scopeSnapshotWithTargetTabs(
    userId: string,
    repoRoot: string,
    scope: string,
    target: { branchName: string; worktreePath: string | null },
    tabs: readonly WorkspacePaneTabEntry[],
  ): WorkspacePaneTabsSnapshot {
    const snapshot = this.scopeSnapshot(userId, repoRoot, scope)
    return {
      ...snapshot,
      entries: snapshot.entries.map((entry) =>
        entry.branchName === target.branchName && entry.worktreePath === target.worktreePath
          ? { ...entry, tabs: [...tabs] }
          : entry,
      ),
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
