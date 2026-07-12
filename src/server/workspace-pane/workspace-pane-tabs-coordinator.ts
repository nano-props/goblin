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
  captureSnapshotForUser(userId: string, scope: string): Promise<{
    revision: number
    liveSessions: WorkspacePaneRuntimeTabsLiveSession[]
  }>
}

interface CanonicalWorkspaceTabsRevisionState {
  layoutRevision: number
  providerRevisions: number[]
  revision: number
}

function mutateCanonicalWorkspaceTabLayout(input: {
  branchName: string
  worktreePath: string | null
  layoutTabs: readonly WorkspacePaneTabEntry[]
  providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
  mutate: (currentTabs: WorkspacePaneTabEntry[]) => WorkspacePaneTabEntry[]
}): WorkspacePaneTabEntry[] {
  const currentTabs = canonicalWorkspaceRuntimeTabsForTarget({
    entry: {
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      tabs: input.layoutTabs,
    },
    providerSnapshots: input.providerSnapshots,
  })
  return input.mutate(currentTabs)
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
  private readonly canonicalRevisionByScope = new Map<string, CanonicalWorkspaceTabsRevisionState>()

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
      const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      const failure = input.guardBeforeWrite?.() ?? null
      if (failure) return failure
      this.worktreeOperations.assertPermit(physicalCapability, input.permit)
      const layoutTabs = mutateCanonicalWorkspaceTabLayout({
        branchName: input.branchName,
        worktreePath: input.worktreePath,
        layoutTabs: this.workspaceTabs.tabs(target),
        providerSnapshots,
        mutate: (currentTabs) => workspacePaneTabsWithRuntimeTab(
          currentTabs,
          input.runtimeType,
          input.sessionId,
          { insertAfterIdentity: input.insertAfterIdentity ?? null },
        ),
      })
      this.workspaceTabs.replaceTabs({
        ...target,
        physicalWorktreeIdentity: physicalCapability.identity,
        tabs: layoutTabs,
      })
      return this.projectedScopeSnapshot(input.userId, input.repoRoot, input.scope, providerSnapshots)
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
        const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
        input.assertCurrent()
        this.workspaceTabs.replaceTabs({
          userId: input.userId,
          scope: input.scope,
          branchName: input.branchName,
          worktreePath: input.worktreePath,
          physicalWorktreeIdentity: physicalCapability?.identity ?? null,
          tabs: input.tabs,
        })
        return this.projectedScopeSnapshot(input.userId, input.repoRoot, input.scope, providerSnapshots)
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
        const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
        input.assertCurrent()
        const layoutTabs = mutateCanonicalWorkspaceTabLayout({
          branchName: input.branchName,
          worktreePath: input.worktreePath,
          layoutTabs: this.workspaceTabs.tabs(target),
          providerSnapshots,
          mutate: (currentTabs) => workspacePaneTabsWithUpdateOperation(currentTabs, input.operation),
        })
        input.assertCurrent()
        this.workspaceTabs.replaceTabs({
          ...target,
          physicalWorktreeIdentity: physicalCapability?.identity ?? null,
          tabs: layoutTabs,
        })
        return this.projectedScopeSnapshot(input.userId, input.repoRoot, input.scope, providerSnapshots)
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
      const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
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
    return await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, async () => {
      const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      return this.projectedScopeSnapshot(input.userId, input.repoRoot, input.scope, providerSnapshots)
    })
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
      this.canonicalRevisionByScope.delete(workspacePaneTabsUserScopeQueueKey(input.userId, input.scope))
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

  private async runtimeProviderSnapshotsForScope(
    userId: string,
    scope: string,
  ): Promise<WorkspacePaneRuntimeTabsProviderSnapshot[]> {
    return await Promise.all(this.runtimeProviders.map(async (provider) => {
      const captured = await provider.captureSnapshotForUser(userId, scope)
      return { type: provider.type, revision: captured.revision, liveSessions: captured.liveSessions }
    }))
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
    return await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, async () => {
      input.assertCurrent()
      const currentProviderSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      input.assertCurrent()
      return this.projectedScopeSnapshot(input.userId, input.repoRoot, input.scope, currentProviderSnapshots)
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

  private projectedScopeSnapshot(
    userId: string,
    repoRoot: string,
    scope: string,
    providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
  ): WorkspacePaneTabsSnapshot {
    return {
      revision: this.canonicalProjectionRevision(userId, scope, providerSnapshots),
      entries: projectCanonicalWorkspacePaneTabs({
        entries: this.workspaceTabs.tabsForScope({ userId, scope }),
        providerSnapshots,
      }).map((entry) => ({ repoRoot, ...entry })),
    }
  }

  private canonicalProjectionRevision(
    userId: string,
    scope: string,
    providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
  ): number {
    const key = workspacePaneTabsUserScopeQueueKey(userId, scope)
    const layoutRevision = this.workspaceTabs.revision({ userId, scope })
    const providerRevisions = providerSnapshots.map((snapshot) => snapshot.revision)
    const current = this.canonicalRevisionByScope.get(key)
    if (!current) {
      this.canonicalRevisionByScope.set(key, { layoutRevision, providerRevisions, revision: layoutRevision })
      return layoutRevision
    }
    if (
      layoutRevision < current.layoutRevision ||
      providerRevisions.some((revision, index) => revision < (current.providerRevisions[index] ?? 0))
    ) {
      throw new Error('error.workspace-tabs-provider-snapshot-stale')
    }
    const changed =
      layoutRevision !== current.layoutRevision ||
      providerRevisions.some((revision, index) => revision !== (current.providerRevisions[index] ?? 0))
    if (!changed) return current.revision
    const revision = Math.max(current.revision + 1, layoutRevision)
    this.canonicalRevisionByScope.set(key, { layoutRevision, providerRevisions, revision })
    return revision
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
