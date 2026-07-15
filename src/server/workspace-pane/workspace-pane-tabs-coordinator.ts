import PQueue from 'p-queue'
import type {
  WorkspacePaneRuntimeTabType,
  WorkspacePaneStaticTabEntry,
  WorkspacePaneTabEntry,
} from '#/shared/workspace-pane.ts'
import { isWorkspacePaneStaticTabType, workspacePaneTabsWithRuntimeTab } from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneDurableLayout,
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateOperation,
} from '#/shared/workspace-pane-tabs.ts'
import { workspacePaneTabsUserScopeQueueKey } from '#/server/workspace-pane/workspace-pane-tabs-user-queue-key.ts'
import type {
  WorkspacePaneTabsRuntime,
  WorkspacePaneTabsScopeEntry,
} from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import type { WorkspacePaneTabsTargetIdentity } from '#/shared/workspace-pane-tabs-target.ts'
import type {
  PhysicalWorktreeOperationCoordinator,
  PhysicalWorktreeOperationPermit,
} from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  physicalWorktreeIdentityKey,
  type PhysicalWorktreeIdentity,
} from '#/server/worktree-removal/physical-worktree-identity.ts'
import type {
  PhysicalWorktreeCapability,
  PhysicalWorktreeIdentityResolver,
} from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import {
  canonicalWorkspaceRuntimeTabsForTarget,
  projectCanonicalWorkspacePaneTabs,
  type WorkspacePaneRuntimeTabsProviderSnapshot,
  workspaceRuntimeTabWorktreePaths,
} from '#/server/workspace-pane/workspace-pane-runtime-tabs-projection.ts'
import type { WorkspacePaneLayoutAggregate } from '#/server/workspace-pane/workspace-pane-layout-aggregate.ts'

type WorkspacePaneTabsCoordinatorRuntime = Pick<
  WorkspacePaneTabsRuntime<string>,
  | 'closeTabsForScope'
  | 'commitPlan'
  | 'scopeEntriesForPlan'
  | 'physicalWorktreeTargets'
  | 'initializeScope'
  | 'isScopeInitialized'
  | 'planReplace'
  | 'planRetire'
  | 'planUpdate'
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
  captureSnapshotForUser(
    userId: string,
    scope: string,
  ): Promise<{
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
  persistLayout: (repoRoot: string, layout: WorkspacePaneDurableLayout) => Promise<unknown>
  layoutAggregate?: WorkspacePaneLayoutAggregate
}

export class WorkspacePaneTabsCoordinator {
  private readonly runtimeProviders: readonly WorkspacePaneRuntimeTabsProvider[]
  private readonly workspaceTabs: WorkspacePaneTabsCoordinatorRuntime
  private readonly worktreeOperations: PhysicalWorktreeOperationCoordinator
  private readonly physicalWorktrees: Pick<PhysicalWorktreeIdentityResolver, 'capture'>
  private readonly persistLayout: (repoRoot: string, layout: WorkspacePaneDurableLayout) => Promise<unknown>
  private readonly layoutAggregate: WorkspacePaneLayoutAggregate | null
  private readonly operationQueuesByScope = new Map<string, PQueue>()
  private readonly canonicalRevisionByScope = new Map<string, CanonicalWorkspaceTabsRevisionState>()

  constructor(options: WorkspacePaneTabsCoordinatorOptions) {
    this.runtimeProviders = options.runtimeProviders
    this.workspaceTabs = options.workspaceTabs
    this.worktreeOperations = options.worktreeOperations
    this.physicalWorktrees = options.physicalWorktrees
    this.persistLayout = options.persistLayout
    this.layoutAggregate = options.layoutAggregate ?? null
    if (this.layoutAggregate) providerRevisionMapForCoordinator(this.runtimeProviders)
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
      repoRoot: input.repoRoot,
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
      if (this.layoutAggregate) {
        const scope = aggregateScope(input.userId, input.repoRoot, input.scope)
        const current = await this.layoutAggregate.snapshot(scope, providerSnapshots)
        const entry = current.entries.find((candidate) => candidate.worktreePath === input.worktreePath)
        const tabs = workspacePaneTabsWithRuntimeTab(
          entry?.tabs ?? [],
          input.runtimeType,
          input.sessionId,
          { insertAfterIdentity: input.insertAfterIdentity ?? null },
        )
        const identity = physicalCapability.identity
        const targetIdentity = { kind: 'worktree' as const, repoRoot: input.repoRoot, worktreePath: input.worktreePath }
        this.layoutAggregate.overlay.registerTargetMetadata({ ...scope, target: targetIdentity, branchName: input.branchName })
        this.layoutAggregate.overlay.registerPhysicalTarget({ ...scope, target: targetIdentity, identity })
        this.layoutAggregate.overlay.recordMixedOrder({ ...scope, target: targetIdentity, tabs })
        const resampled = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
        return await this.layoutAggregate.snapshot(scope, resampled)
      }
      const layoutTabs = mutateCanonicalWorkspaceTabLayout({
        branchName: input.branchName,
        worktreePath: input.worktreePath,
        layoutTabs: this.workspaceTabs.tabs(target),
        providerSnapshots,
        mutate: (currentTabs) =>
          workspacePaneTabsWithRuntimeTab(currentTabs, input.runtimeType, input.sessionId, {
            insertAfterIdentity: input.insertAfterIdentity ?? null,
          }),
      })
      const plan = this.workspaceTabs.planReplace({
        ...target,
        physicalWorktreeIdentity: physicalCapability.identity,
        tabs: layoutTabs,
      })
      this.workspaceTabs.commitPlan(plan)
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
    const operation = async () => {
      if (this.layoutAggregate) {
        return await this.runAggregateCommand(input, async (providerSnapshots) => {
          const result = await this.layoutAggregate!.replace({
            ...aggregateScope(input.userId, input.repoRoot, input.scope),
            branchName: input.branchName,
            worktreePath: input.worktreePath,
            tabs: input.tabs,
            providerSnapshots,
            assertCurrent: input.assertCurrent,
          })
          if (physicalCapability) {
            this.layoutAggregate!.overlay.registerPhysicalTarget({
              ...aggregateScope(input.userId, input.repoRoot, input.scope),
              target: { kind: 'worktree', repoRoot: input.repoRoot, worktreePath: input.worktreePath! },
              identity: physicalCapability.identity,
            })
          }
          return result
        })
      }
      return await this.runScopeCommand({
        userId: input.userId,
        repoRoot: input.repoRoot,
        scope: input.scope,
        validate: input.assertCurrent,
        plan: () => {
          return this.workspaceTabs.planReplace({
            userId: input.userId,
            repoRoot: input.repoRoot,
            scope: input.scope,
            branchName: input.branchName,
            worktreePath: input.worktreePath,
            physicalWorktreeIdentity: physicalCapability?.identity ?? null,
            tabs: input.tabs,
          })
        },
      })
    }
    if (input.worktreePath === null) return await operation()
    physicalCapability = await this.capturePhysicalWorktree(input, input.worktreePath)
    const result = await this.worktreeOperations.runOperation(physicalCapability, operation)
    if (!result.admitted) throw new Error('error.worktree-removal-in-progress')
    return result.value
  }

  async initializeScope(input: {
    userId: string
    repoRoot: string
    scope: string
    entries: readonly WorkspacePaneTabsScopeEntry[]
    assertCurrent: () => void
  }): Promise<WorkspacePaneTabsSnapshot> {
    if (this.layoutAggregate) {
      input.assertCurrent()
      const providers = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      input.assertCurrent()
      return await this.layoutAggregate.snapshot(aggregateScope(input.userId, input.repoRoot, input.scope), providers)
    }
    const capturedWorktrees = await Promise.all(
      Array.from(new Set(input.entries.flatMap((entry) => entry.worktreePath ?? []))).map(async (worktreePath) => ({
        worktreePath,
        capability: await this.capturePhysicalWorktree(input, worktreePath),
      })),
    )
    capturedWorktrees.sort((a, b) =>
      physicalWorktreeIdentityKey(a.capability.identity).localeCompare(
        physicalWorktreeIdentityKey(b.capability.identity),
      ),
    )
    const capabilities = Array.from(
      new Map(
        capturedWorktrees.map(
          ({ capability }) => [physicalWorktreeIdentityKey(capability.identity), capability] as const,
        ),
      ).values(),
    )

    return await this.runWithPhysicalWorktrees(
      capabilities,
      0,
      async () =>
        await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, async () => {
          input.assertCurrent()
          const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
          input.assertCurrent()
          if (!this.workspaceTabs.isScopeInitialized({ userId: input.userId, scope: input.scope })) {
            const capabilityByPath = new Map(
              capturedWorktrees.map(({ worktreePath, capability }) => [worktreePath, capability] as const),
            )
            for (const entry of input.entries) {
              const capability = entry.worktreePath === null ? null : (capabilityByPath.get(entry.worktreePath) ?? null)
              const plan = this.workspaceTabs.planReplace({
                userId: input.userId,
                repoRoot: input.repoRoot,
                scope: input.scope,
                branchName: entry.branchName,
                worktreePath: entry.worktreePath,
                physicalWorktreeIdentity: capability?.identity ?? null,
                tabs: entry.tabs,
              })
              this.workspaceTabs.commitPlan(plan)
            }
            this.workspaceTabs.initializeScope({ userId: input.userId, scope: input.scope })
          }
          return this.projectedScopeSnapshot(input.userId, input.repoRoot, input.scope, providerSnapshots)
        }),
    )
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
      if (this.layoutAggregate) {
        return await this.runAggregateCommand(input, async (providerSnapshots) => {
          const result = await this.layoutAggregate!.update({
            ...aggregateScope(input.userId, input.repoRoot, input.scope),
            branchName: input.branchName,
            worktreePath: input.worktreePath,
            operation: input.operation,
            providerSnapshots,
            assertCurrent: input.assertCurrent,
          })
          if (physicalCapability) {
            this.layoutAggregate!.overlay.registerPhysicalTarget({
              ...aggregateScope(input.userId, input.repoRoot, input.scope),
              target: { kind: 'worktree', repoRoot: input.repoRoot, worktreePath: input.worktreePath! },
              identity: physicalCapability.identity,
            })
          }
          return result
        })
      }
      return await this.runScopeCommand({
        userId: input.userId,
        repoRoot: input.repoRoot,
        scope: input.scope,
        validate: input.assertCurrent,
        plan: (providerSnapshots) => {
          const target = {
            userId: input.userId,
            repoRoot: input.repoRoot,
            scope: input.scope,
            branchName: input.branchName,
            worktreePath: input.worktreePath,
          }
          const currentTabs = canonicalWorkspaceRuntimeTabsForTarget({
            entry: {
              branchName: input.branchName,
              worktreePath: input.worktreePath,
              tabs: this.workspaceTabs.tabs(target),
            },
            providerSnapshots,
          })
          return this.workspaceTabs.planUpdate({
            ...target,
            physicalWorktreeIdentity: physicalCapability?.identity ?? null,
            currentTabs,
            operation: input.operation,
          })
        },
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
      return this.layoutAggregate
        ? await this.layoutAggregate.snapshot(
            aggregateScope(input.userId, input.repoRoot, input.scope),
            providerSnapshots,
          )
        : this.projectedScopeSnapshot(input.userId, input.repoRoot, input.scope, providerSnapshots)
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
    if (this.layoutAggregate) {
      return await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, async () => {
        const providers = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
        return await this.layoutAggregate!.snapshot(aggregateScope(input.userId, input.repoRoot, input.scope), providers)
      })
    }
    return await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, async () => {
      const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      return this.projectedScopeSnapshot(input.userId, input.repoRoot, input.scope, providerSnapshots)
    })
  }

  async closeScope(input: { userId: string; scope: string }): Promise<void> {
    if (this.layoutAggregate) {
      const repoRoot = repoRootFromScope(input.scope)
      this.layoutAggregate.closeEpoch(aggregateScope(input.userId, repoRoot, input.scope))
      return
    }
    await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, () => {
      this.workspaceTabs.closeTabsForScope(input.userId, input.scope)
    })
  }

  async closeInvalidatedScope(input: { userId: string; scope: string }): Promise<void> {
    if (this.layoutAggregate) {
      const repoRoot = repoRootFromScope(input.scope)
      this.layoutAggregate.closeEpoch(aggregateScope(input.userId, repoRoot, input.scope))
      return
    }
    await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, () => {
      this.workspaceTabs.closeTabsForScope(input.userId, input.scope)
      this.workspaceTabs.releaseRevisionForScope(input.userId, input.scope)
      this.canonicalRevisionByScope.delete(workspacePaneTabsUserScopeQueueKey(input.userId, input.scope))
    })
  }

  physicalWorktreeTargets(identity: PhysicalWorktreeIdentity) {
    if (this.layoutAggregate) {
      return this.layoutAggregate.overlay.physicalTargets(identity).map((ref) => ({
        userId: ref.userId,
        scope: scopeFromAggregate(ref),
        target: ref.target,
        repoRuntimeId: ref.repoRuntimeId,
      }))
    }
    return this.workspaceTabs.physicalWorktreeTargets(identity).map((target) => ({
      ...target,
      repoRuntimeId: repoRuntimeIdFromScope(target.scope),
    }))
  }

  async retireTarget(input: {
    userId: string
    scope: string
    target: WorkspacePaneTabsTargetIdentity
    assertCurrent?: () => void
  }): Promise<WorkspacePaneTabsSnapshot> {
    if (this.layoutAggregate) {
      return await this.runAggregateCommand({
        userId: input.userId,
        repoRoot: input.target.repoRoot,
        scope: input.scope,
        assertCurrent: input.assertCurrent,
      }, async (providerSnapshots) => await this.layoutAggregate!.retire({
        ...aggregateScope(input.userId, input.target.repoRoot, input.scope),
        target: input.target,
        providerSnapshots,
        assertCurrent: input.assertCurrent,
      }))
    }
    return await this.runScopeCommand({
      userId: input.userId,
      repoRoot: input.target.repoRoot,
      scope: input.scope,
      validate: input.assertCurrent,
      plan: () => this.workspaceTabs.planRetire(input),
    })
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
    if (this.layoutAggregate) {
      for (const scope of this.layoutAggregate.overlay.epochsForUser(input.userId)) this.layoutAggregate.closeEpoch(scope)
      return
    }
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
    const scopeEntries = this.layoutAggregate
      ? (await this.layoutAggregate.snapshot(
          aggregateScope(input.userId, input.repoRoot, input.scope),
          providerSnapshots,
        )).entries
      : this.workspaceTabs.tabsForScope({ userId: input.userId, scope: input.scope })
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
      return this.layoutAggregate
        ? await this.layoutAggregate.snapshot(
            aggregateScope(input.userId, input.repoRoot, input.scope),
            currentProviderSnapshots,
          )
        : this.projectedScopeSnapshot(input.userId, input.repoRoot, input.scope, currentProviderSnapshots)
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
      return await this.layoutAggregate!.snapshot(
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

  private async runWithPhysicalWorktrees<T>(
    capabilities: readonly PhysicalWorktreeCapability[],
    index: number,
    task: () => Promise<T>,
  ): Promise<T> {
    const capability = capabilities[index]
    if (!capability) return await task()
    const result = await this.worktreeOperations.runOperation(
      capability,
      async () => await this.runWithPhysicalWorktrees(capabilities, index + 1, task),
    )
    if (!result.admitted) throw new Error('error.worktree-removal-in-progress')
    return result.value
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

  private async runScopeCommand(input: {
    userId: string
    repoRoot: string
    scope: string
    validate?: () => void
    plan: (
      providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
    ) => ReturnType<WorkspacePaneTabsCoordinatorRuntime['planReplace']>
  }): Promise<WorkspacePaneTabsSnapshot> {
    return await this.runWorkspaceTabsScopeOperation(input.userId, input.scope, async () => {
      input.validate?.()
      const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      input.validate?.()
      const plan = input.plan(providerSnapshots)
      const layout: WorkspacePaneDurableLayout = {
        entries: this.workspaceTabs.scopeEntriesForPlan(plan).map((entry) => ({
          ...entry,
          tabs: entry.tabs.filter((tab): tab is WorkspacePaneStaticTabEntry => isWorkspacePaneStaticTabType(tab.type)),
        })),
      }
      await this.persistLayout(input.repoRoot, layout)
      this.workspaceTabs.commitPlan(plan)
      return this.projectedScopeSnapshot(input.userId, input.repoRoot, input.scope, providerSnapshots)
    })
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
