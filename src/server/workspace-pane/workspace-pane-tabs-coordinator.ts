import PQueue from 'p-queue'
import type {
  WorkspacePaneRuntimeTabType,
  WorkspacePaneTabEntry,
} from '#/shared/workspace-pane.ts'
import { isWorkspacePaneStaticTabType, workspacePaneTabsWithRuntimeTab } from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateOperation,
} from '#/shared/workspace-pane-tabs.ts'
import { workspacePaneTabsUserScopeQueueKey } from '#/server/workspace-pane/workspace-pane-tabs-user-queue-key.ts'
import type { WorkspacePaneTabsTargetIdentity } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type {
  PhysicalWorktreeOperationCoordinator,
  PhysicalWorktreeOperationPermit,
} from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import type { PhysicalWorktreeIdentity } from '#/server/worktree-removal/physical-worktree-identity.ts'
import type {
  PhysicalWorktreeCapability,
  PhysicalWorktreeIdentityResolver,
} from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import {
  type WorkspacePaneRuntimeTabsProviderSnapshot,
  workspaceRuntimeTabWorktreePaths,
} from '#/server/workspace-pane/workspace-pane-runtime-tabs-projection.ts'
import type { WorkspacePaneLayoutAggregate } from '#/server/workspace-pane/workspace-pane-layout-aggregate.ts'

export interface WorkspacePaneRuntimeTabsLiveSession {
  sessionId: string
  branch: string
  worktreePath: string
}

export interface WorkspacePaneRuntimeTabsProvider {
  type: WorkspacePaneRuntimeTabType
  captureSnapshotForUser(
    userId: string,
    scope: string,
  ): Promise<{
    revision: number
    liveSessions: WorkspacePaneRuntimeTabsLiveSession[]
  }>
}

interface WorkspacePaneTabsCoordinatorOptions {
  runtimeProviders: readonly WorkspacePaneRuntimeTabsProvider[]
  worktreeOperations: PhysicalWorktreeOperationCoordinator
  physicalWorktrees: Pick<PhysicalWorktreeIdentityResolver, 'capture'>
  layoutAggregate: WorkspacePaneLayoutAggregate
}

export class WorkspacePaneTabsCoordinator {
  private readonly runtimeProviders: readonly WorkspacePaneRuntimeTabsProvider[]
  private readonly worktreeOperations: PhysicalWorktreeOperationCoordinator
  private readonly physicalWorktrees: Pick<PhysicalWorktreeIdentityResolver, 'capture'>
  private readonly layoutAggregate: WorkspacePaneLayoutAggregate
  private readonly operationQueuesByScope = new Map<string, PQueue>()

  constructor(options: WorkspacePaneTabsCoordinatorOptions) {
    this.runtimeProviders = options.runtimeProviders
    this.worktreeOperations = options.worktreeOperations
    this.physicalWorktrees = options.physicalWorktrees
    this.layoutAggregate = options.layoutAggregate
    providerRevisionMapForCoordinator(this.runtimeProviders)
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
    const physicalCapability = input.physicalWorktreeCapability
    return await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, async () => {
      this.worktreeOperations.assertPermit(physicalCapability, input.permit)
      const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      const failure = input.guardBeforeWrite?.() ?? null
      if (failure) return failure
      this.worktreeOperations.assertPermit(physicalCapability, input.permit)
      const scope = aggregateScope(input.userId, input.repoRoot, input.scope)
      const current = await this.layoutAggregate.snapshot(scope, providerSnapshots)
      const entry = current.entries.find((candidate) => candidate.worktreePath === input.worktreePath)
      const tabs = workspacePaneTabsWithRuntimeTab(
        entry?.tabs ?? [],
        input.runtimeType,
        input.sessionId,
        { insertAfterIdentity: input.insertAfterIdentity ?? null },
      )
      const targetIdentity = { kind: 'worktree' as const, repoRoot: input.repoRoot, worktreePath: input.worktreePath }
      this.layoutAggregate.overlay.registerTargetMetadata({ ...scope, target: targetIdentity, branchName: input.branchName })
      this.layoutAggregate.overlay.registerPhysicalTarget({ ...scope, target: targetIdentity, identity: physicalCapability.identity })
      this.layoutAggregate.overlay.recordMixedOrder({ ...scope, target: targetIdentity, tabs })
      const resampled = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      return await this.layoutAggregate.snapshot(scope, resampled)
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
    const operation = async () => {
      return await this.runAggregateCommand(input, async (providerSnapshots) => {
          const result = await this.layoutAggregate.replace({
            ...aggregateScope(input.userId, input.repoRoot, input.scope),
            branchName: input.branchName,
            worktreePath: input.worktreePath,
            tabs: input.tabs,
            providerSnapshots,
            assertCurrent: input.assertCurrent,
          })
          if (physicalCapability) {
            this.layoutAggregate.overlay.registerPhysicalTarget({
              ...aggregateScope(input.userId, input.repoRoot, input.scope),
              target: { kind: 'worktree', repoRoot: input.repoRoot, worktreePath: input.worktreePath! },
              identity: physicalCapability.identity,
            })
          }
          return result
      })
    }
    if (input.worktreePath === null) return await operation()
    physicalCapability = await this.capturePhysicalWorktree(input, input.worktreePath)
    const result = await this.worktreeOperations.runOperation(physicalCapability, operation)
    if (!result.admitted) throw new Error('error.worktree-removal-in-progress')
    return result.value
  }

  async restoreScope(input: {
    userId: string
    repoRoot: string
    scope: string
    targets: readonly WorkspacePaneTabsTarget[]
    expectedRepoEntry: RepoSessionEntry
    assertCurrent: () => void
  }): Promise<WorkspacePaneTabsSnapshot> {
    return await this.runWorkspaceTabsOperationByKey(`repo\0${input.repoRoot}`, async () => {
      input.assertCurrent()
      const providers = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      input.assertCurrent()
      return await this.layoutAggregate.validateRepairAndSnapshot({
        ...aggregateScope(input.userId, input.repoRoot, input.scope),
        validTargets: input.targets,
        expectedRepoEntry: input.expectedRepoEntry,
        providerSnapshots: providers,
        assertCurrent: input.assertCurrent,
      })
    })
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
    const operation = async () => {
      return await this.runAggregateCommand(input, async (providerSnapshots) => {
          const result = await this.layoutAggregate.update({
            ...aggregateScope(input.userId, input.repoRoot, input.scope),
            branchName: input.branchName,
            worktreePath: input.worktreePath,
            operation: input.operation,
            providerSnapshots,
            assertCurrent: input.assertCurrent,
          })
          if (physicalCapability) {
            this.layoutAggregate.overlay.registerPhysicalTarget({
              ...aggregateScope(input.userId, input.repoRoot, input.scope),
              target: { kind: 'worktree', repoRoot: input.repoRoot, worktreePath: input.worktreePath! },
              identity: physicalCapability.identity,
            })
          }
          return result
      })
    }
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
    const result = await this.worktreeOperations.runOperation(
      capability,
      async (permit) =>
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
      return await this.layoutAggregate.snapshot(
        aggregateScope(input.userId, input.repoRoot, input.scope),
        providerSnapshots,
      )
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
      const providers = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      return await this.layoutAggregate.snapshot(aggregateScope(input.userId, input.repoRoot, input.scope), providers)
    })
  }

  async closeScope(input: { userId: string; scope: string }): Promise<void> {
    const repoRoot = repoRootFromScope(input.scope)
    this.layoutAggregate.closeEpoch(aggregateScope(input.userId, repoRoot, input.scope))
  }

  async closeInvalidatedScope(input: { userId: string; scope: string }): Promise<void> {
    await this.closeScope(input)
  }

  physicalWorktreeTargets(identity: PhysicalWorktreeIdentity) {
    return this.layoutAggregate.overlay.physicalTargets(identity).map((ref) => ({
        userId: ref.userId,
        scope: scopeFromAggregate(ref),
        target: ref.target,
        repoRuntimeId: ref.repoRuntimeId,
      }))
  }

  async retireTarget(input: {
    userId: string
    scope: string
    target: WorkspacePaneTabsTargetIdentity
    assertCurrent?: () => void
  }): Promise<WorkspacePaneTabsSnapshot> {
    return await this.runAggregateCommand({
        userId: input.userId,
        repoRoot: input.target.repoRoot,
        scope: input.scope,
        assertCurrent: input.assertCurrent,
      }, async (providerSnapshots) => await this.layoutAggregate.retire({
        ...aggregateScope(input.userId, input.target.repoRoot, input.scope),
        target: input.target,
        providerSnapshots,
        assertCurrent: input.assertCurrent,
      }))
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
    for (const scope of this.layoutAggregate.overlay.epochsForUser(input.userId)) this.layoutAggregate.closeEpoch(scope)
  }

  private async runtimeProviderSnapshotsForScope(
    userId: string,
    scope: string,
  ): Promise<WorkspacePaneRuntimeTabsProviderSnapshot[]> {
    return await Promise.all(
      this.runtimeProviders.map(async (provider) => {
        const captured = await provider.captureSnapshotForUser(userId, scope)
        return { type: provider.type, revision: captured.revision, liveSessions: captured.liveSessions }
      }),
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
    const scopeEntries = (await this.layoutAggregate.snapshot(
      aggregateScope(input.userId, input.repoRoot, input.scope),
      providerSnapshots,
    )).entries
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
      return await this.layoutAggregate.snapshot(
        aggregateScope(input.userId, input.repoRoot, input.scope),
        currentProviderSnapshots,
      )
    })
  }

  private async runAggregateCommand(
    input: { userId: string; repoRoot: string; scope: string; assertCurrent?: () => void },
    command: (providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]) => Promise<WorkspacePaneTabsSnapshot>,
  ): Promise<WorkspacePaneTabsSnapshot> {
    return await this.runWorkspaceTabsOperationByKey(`repo\0${input.repoRoot}`, async () => {
      input.assertCurrent?.()
      const providers = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      input.assertCurrent?.()
      await command(providers)
      const resampled = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      input.assertCurrent?.()
      return await this.layoutAggregate.snapshot(
        aggregateScope(input.userId, input.repoRoot, input.scope),
        resampled,
      )
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

function repoRuntimeIdFromScope(scope: string): string {
  const separator = scope.lastIndexOf('\0')
  if (separator < 0 || separator === scope.length - 1) throw new Error('invalid workspace pane runtime scope')
  return scope.slice(separator + 1)
}

function repoRootFromScope(scope: string): string {
  const separator = scope.lastIndexOf('\0')
  if (separator < 1) throw new Error('invalid workspace pane runtime scope')
  return scope.slice(0, separator)
}

function aggregateScope(userId: string, repoRoot: string, scope: string) {
  return { userId, repoRoot, repoRuntimeId: repoRuntimeIdFromScope(scope) }
}

function scopeFromAggregate(scope: { repoRoot: string; repoRuntimeId: string }): string {
  return `${scope.repoRoot}\0${scope.repoRuntimeId}`
}

function providerRevisionMapForCoordinator(providers: readonly WorkspacePaneRuntimeTabsProvider[]): void {
  const types = new Set<WorkspacePaneRuntimeTabType>()
  for (const provider of providers) {
    if (types.has(provider.type)) throw new Error('error.workspace-tabs-provider-type-duplicate')
    types.add(provider.type)
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
