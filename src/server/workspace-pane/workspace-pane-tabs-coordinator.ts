import type { WorkspacePaneRuntimeTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneTabsEntry,
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateOperation,
} from '#/shared/workspace-pane-tabs.ts'
import { runtimeWorkspacePaneTargetKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import { canonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  assertWorkspaceRuntimeEpochCapability,
  WorkspaceRuntimeStaleError,
  type WorkspaceRuntimeEpochCapability,
  type WorkspaceRuntimeMembershipCapability,
} from '#/server/modules/workspace-runtimes.ts'
import type {
  PhysicalWorktreeOperationCoordinator,
  PhysicalWorktreeOperationPermit,
} from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import type { PhysicalWorktreeIdentity } from '#/server/worktree-removal/physical-worktree-identity.ts'
import {
  physicalWorktreeExecutionScope,
  physicalWorktreeAdmissionLease,
  physicalWorktreeAdmissionLeaseKey,
  type PhysicalWorktreeAdmissionLease,
  type PhysicalWorktreeExecutionCapability,
} from '#/server/worktree-removal/physical-worktree-capability.ts'
import type { PhysicalWorktreeCapture } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import {
  admissionRecords,
  capabilitiesByIdentity,
  mergeCurrentCapabilities,
  uniqueSortedAdmissionLeases,
  uniqueSortedCapabilities,
} from '#/server/workspace-pane/workspace-pane-physical-admission.ts'

import {
  type WorkspacePaneRuntimeTabsProviderSnapshot,
  workspaceRuntimeTabWorktreePaths,
} from '#/server/workspace-pane/workspace-pane-runtime-tabs-projection.ts'

import type {
  WorkspacePaneLayoutAggregate,
  WorkspacePaneLayoutCommitResult,
  WorkspacePaneLayoutOperation,
  WorkspacePaneLayoutValidationResult,
} from '#/server/workspace-pane/workspace-pane-layout-aggregate.ts'
import type { WorkspacePaneTargetProjection } from '#/server/workspace-pane/workspace-pane-layout-projection.ts'

export interface WorkspacePaneRuntimeTabsLiveSession {
  sessionId: string
  target: RuntimeWorkspacePaneTarget
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

export interface WorkspacePaneTargetProjectionProvider {
  captureTargets(
    userId: string,
    workspaceId: WorkspaceId,
    scope: string,
  ): Promise<readonly WorkspacePaneTargetProjection[]>
}

export type WorkspacePaneTabsCommandResult =
  | (WorkspacePaneLayoutCommitResult & { kind: 'projected'; snapshot: WorkspacePaneTabsSnapshot })
  | (WorkspacePaneLayoutCommitResult & { kind: 'committed-projection-failed'; error: unknown })

export type WorkspacePaneRuntimeTabCommitResult =
  { kind: 'committed'; snapshot: WorkspacePaneTabsSnapshot } | { kind: 'runtime-stale' } | { kind: 'target-stale' }

export interface WorkspaceRuntimeTabPlacementInput {
  userId: string
  target: RuntimeWorkspacePaneTarget
  worktreePath: string
  runtimeType: WorkspacePaneRuntimeTabType
  sessionId: string
  insertAfterIdentity?: string | null
  permit: PhysicalWorktreeOperationPermit
  physicalWorktreeCapability: PhysicalWorktreeExecutionCapability
  epochCapability: WorkspaceRuntimeMembershipCapability
  commitAdmission: () => void
}

export interface WorkspacePaneRuntimeTabsCoordinator {
  ensureRuntimeTabForSession(input: WorkspaceRuntimeTabPlacementInput): Promise<WorkspacePaneRuntimeTabCommitResult>
  reconcileWorktreeAdmitted(input: {
    userId: string
    workspaceId: WorkspaceId
    scope: string
    worktreePath: string
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability
    permit: PhysicalWorktreeOperationPermit
    epochCapability: WorkspaceRuntimeEpochCapability
  }): Promise<WorkspacePaneTabsSnapshot>
}

export interface WorkspacePaneTabsCoordinatorOptions {
  runtimeProviders: readonly WorkspacePaneRuntimeTabsProvider[]
  worktreeOperations: PhysicalWorktreeOperationCoordinator
  physicalWorktrees: PhysicalWorktreeCapture
  layoutAggregate: WorkspacePaneLayoutAggregate
  targetProjection: WorkspacePaneTargetProjectionProvider
}

export class WorkspacePaneTabsCoordinator implements WorkspacePaneRuntimeTabsCoordinator {
  private readonly runtimeProviders: readonly WorkspacePaneRuntimeTabsProvider[]
  private readonly worktreeOperations: PhysicalWorktreeOperationCoordinator
  private readonly physicalWorktrees: PhysicalWorktreeCapture
  private readonly layoutAggregate: WorkspacePaneLayoutAggregate
  private readonly targetProjection: WorkspacePaneTargetProjectionProvider

  constructor(options: WorkspacePaneTabsCoordinatorOptions) {
    this.runtimeProviders = options.runtimeProviders
    this.worktreeOperations = options.worktreeOperations
    this.physicalWorktrees = options.physicalWorktrees
    this.layoutAggregate = options.layoutAggregate
    this.targetProjection = options.targetProjection
    assertUniqueRuntimeProviderTypes(this.runtimeProviders)
  }

  async ensureRuntimeTabForSession(
    input: WorkspaceRuntimeTabPlacementInput,
  ): Promise<WorkspacePaneRuntimeTabCommitResult> {
    const physicalCapability = input.physicalWorktreeCapability
    const physicalScope = physicalWorktreeExecutionScope(physicalCapability)
    if (
      physicalScope.worktreePath !== input.worktreePath ||
      physicalScope.userId !== input.userId ||
      physicalScope.workspaceId !== input.target.workspaceId ||
      physicalScope.workspaceRuntimeId !== input.target.workspaceRuntimeId
    ) {
      return { kind: 'runtime-stale' }
    }
    const workspaceId = input.target.workspaceId
    const runtimeScope = `${input.target.workspaceId}\0${input.target.workspaceRuntimeId}`
    const scope = aggregateScope(input.userId, workspaceId, runtimeScope)
    assertWorkspaceRuntimeEpochCapability(input.epochCapability, scope)
    return await this.runWorkspaceTabsOperation(workspaceId, async (layout) => {
      this.worktreeOperations.assertPermit(physicalCapability, input.permit)
      const capturedTargets = await this.targetProjection.captureTargets(input.userId, workspaceId, runtimeScope)
      const capturedTarget = capturedTargets.find(
        (projection) => projectionKey(projection) === runtimeTargetKey(input.target),
      )
      if (!capturedTarget || capturedTarget.nativeWorktreePath !== input.worktreePath) {
        return { kind: 'target-stale' }
      }
      const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, runtimeScope)
      assertWorkspaceRuntimeEpochCapability(input.epochCapability, scope)
      this.worktreeOperations.assertPermit(physicalCapability, input.permit)
      // The complete catalog is the authoritative before-set used by the
      // atomic layout projection below. Re-reading this one worktree here did
      // not make Git state atomic (HEAD can change after either command), but
      // it did add a second SSH/Git round trip before PTY admission.
      const pendingProviderSnapshots = providerSnapshotsWithPendingSession(providerSnapshots, {
        type: input.runtimeType,
        sessionId: input.sessionId,
        target: capturedTarget.target,
        worktreePath: input.worktreePath,
      })
      assertWorkspaceRuntimeEpochCapability(input.epochCapability, scope)
      this.worktreeOperations.assertPermit(physicalCapability, input.permit)
      const snapshot = await layout.commitRuntimeTabPlacement(
        {
          ...scope,
          target: capturedTarget.target,
          lease: physicalWorktreeAdmissionLease(physicalCapability),
          intent: {
            runtimeType: input.runtimeType,
            sessionId: input.sessionId,
            insertAfterIdentity: input.insertAfterIdentity ?? null,
          },
          validTargets: capturedTargets,
          stagedProviderSnapshots: pendingProviderSnapshots,
          epochCapability: input.epochCapability,
        },
        () => {
          this.worktreeOperations.assertPermit(physicalCapability, input.permit)
          input.commitAdmission()
        },
      )
      return { kind: 'committed', snapshot }
    })
  }

  async restoreScope(input: {
    userId: string
    workspaceId: WorkspaceId
    scope: string
    targets: readonly WorkspacePaneTargetProjection[]
    expectedWorkspaceEntry: WorkspaceSessionEntry
    epochCapability: WorkspaceRuntimeEpochCapability
  }): Promise<WorkspacePaneLayoutValidationResult> {
    assertWorkspaceRuntimeEpochCapability(
      input.epochCapability,
      aggregateScope(input.userId, input.workspaceId, input.scope),
    )
    const worktreeTargets = input.targets.filter(isWorkspacePaneWorktreeTarget)
    const capturedWorktrees = await Promise.all(
      worktreeTargets.map(async (target) => ({
        target,
        capability: await this.capturePhysicalWorktree(input, target.nativeWorktreePath),
      })),
    )
    const scope = aggregateScope(input.userId, input.workspaceId, input.scope)
    const indexedLeases = await this.runWorkspaceTabsOperation(input.workspaceId, (layout) =>
      layout.indexedAdmissionLeases(scope),
    )
    let lockTargets = uniqueSortedAdmissionLeases([
      ...capturedWorktrees.map(({ capability }) => physicalWorktreeAdmissionLease(capability)),
      ...indexedLeases,
    ])
    const validatedCapabilities = capabilitiesByIdentity(capturedWorktrees.map(({ capability }) => capability))
    for (;;) {
      let expandedLockTargets: PhysicalWorktreeAdmissionLease[] | null = null
      const result = await this.runWithPhysicalWorktrees(
        lockTargets,
        validatedCapabilities,
        async () =>
          await this.runWorkspaceTabsOperation(input.workspaceId, async (layout) => {
            const requiredLockTargets = uniqueSortedAdmissionLeases([
              ...capturedWorktrees.map(({ capability }) => physicalWorktreeAdmissionLease(capability)),
              ...layout.indexedAdmissionLeases(scope),
            ])
            const admittedIdentities = new Set(lockTargets.map(physicalWorktreeAdmissionLeaseKey))
            if (
              requiredLockTargets.some((target) => !admittedIdentities.has(physicalWorktreeAdmissionLeaseKey(target)))
            ) {
              expandedLockTargets = uniqueSortedAdmissionLeases([...lockTargets, ...requiredLockTargets])
              return null
            }
            const providers = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
            assertWorkspaceRuntimeEpochCapability(input.epochCapability, scope)
            return await layout.validateMembershipAndSnapshot({
              ...scope,
              validTargets: input.targets,
              physicalTargets: capturedWorktrees.map(({ target, capability }) => ({
                target: target.target,
                lease: physicalWorktreeAdmissionLease(capability),
              })),
              expectedWorkspaceEntry: input.expectedWorkspaceEntry,
              providerSnapshots: providers,
              epochCapability: input.epochCapability,
            })
          }),
      )
      if (result) return result
      if (!expandedLockTargets) throw new Error('workspace pane restore admission did not expand')
      lockTargets = expandedLockTargets
    }
  }

  async updateTabs(input: {
    userId: string
    workspaceId: WorkspaceId
    scope: string
    target: RuntimeWorkspacePaneTarget
    nativeWorktreePath: string | null
    operation: WorkspacePaneTabsUpdateOperation
    epochCapability: WorkspaceRuntimeMembershipCapability
  }): Promise<WorkspacePaneTabsCommandResult> {
    assertWorkspaceRuntimeEpochCapability(
      input.epochCapability,
      aggregateScope(input.userId, input.workspaceId, input.scope),
    )
    if (input.nativeWorktreePath === null) {
      return await this.runAggregateCommand(input, async (layout, validTargets, providerSnapshots, epochCapability) => {
        return await layout.update({
          ...aggregateScope(input.userId, input.workspaceId, input.scope),
          target: input.target,
          nativeWorktreePath: null,
          operation: input.operation,
          validTargets,
          providerSnapshots,
          epochCapability,
        })
      })
    }
    const worktreePath = input.nativeWorktreePath
    const physicalCapability = await this.capturePhysicalWorktree(input, worktreePath)
    const result = await this.worktreeOperations.runOperation(
      physicalCapability,
      async () =>
        await this.runAggregateCommand(
          input,
          async (layout, validTargets, providerSnapshots, epochCapability) =>
            await layout.update({
              ...aggregateScope(input.userId, input.workspaceId, input.scope),
              target: input.target,
              nativeWorktreePath: worktreePath,
              operation: input.operation,
              validTargets,
              providerSnapshots,
              physicalWorktreeLease: physicalWorktreeAdmissionLease(physicalCapability),
              epochCapability,
            }),
        ),
    )
    if (!result.admitted) throw new Error('error.worktree-removal-in-progress')
    return result.value
  }

  async reconcileWorktree(input: {
    userId: string
    workspaceId: WorkspaceId
    scope: string
    worktreePath: string
    epochCapability: WorkspaceRuntimeEpochCapability
  }): Promise<WorkspacePaneTabsSnapshot> {
    assertWorkspaceRuntimeEpochCapability(
      input.epochCapability,
      aggregateScope(input.userId, input.workspaceId, input.scope),
    )
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
    workspaceId: WorkspaceId
    scope: string
    worktreePath: string
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability
    permit: PhysicalWorktreeOperationPermit
    epochCapability: WorkspaceRuntimeEpochCapability
  }): Promise<WorkspacePaneTabsSnapshot> {
    this.worktreeOperations.assertPermit(input.physicalWorktreeCapability, input.permit)
    return await this.runWorkspaceTabsOperation(input.workspaceId, async (layout) => {
      const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      const validTargets = await this.targetProjection.captureTargets(input.userId, input.workspaceId, input.scope)
      this.worktreeOperations.assertPermit(input.physicalWorktreeCapability, input.permit)
      assertWorkspaceRuntimeEpochCapability(
        input.epochCapability,
        aggregateScope(input.userId, input.workspaceId, input.scope),
      )
      return await layout.snapshot({
        scope: aggregateScope(input.userId, input.workspaceId, input.scope),
        validTargets,
        providerSnapshots,
        epochCapability: input.epochCapability,
      })
    })
  }

  async listWorkspaceTabs(input: {
    userId: string
    workspaceId: WorkspaceId
    scope: string
    epochCapability: WorkspaceRuntimeMembershipCapability
  }): Promise<WorkspacePaneTabsSnapshot> {
    return await this.reconcileWorkspaceTabsProjectionBoundary(input)
  }

  async snapshot(input: {
    userId: string
    workspaceId: WorkspaceId
    scope: string
    epochCapability: WorkspaceRuntimeEpochCapability
  }): Promise<WorkspacePaneTabsSnapshot> {
    assertWorkspaceRuntimeEpochCapability(
      input.epochCapability,
      aggregateScope(input.userId, input.workspaceId, input.scope),
    )
    return await this.runWorkspaceTabsOperation(input.workspaceId, async (layout) => {
      const providers = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      const validTargets = await this.targetProjection.captureTargets(input.userId, input.workspaceId, input.scope)
      return await layout.snapshot({
        scope: aggregateScope(input.userId, input.workspaceId, input.scope),
        validTargets,
        providerSnapshots: providers,
        epochCapability: input.epochCapability,
      })
    })
  }

  async withExclusiveSnapshot(
    input: {
      userId: string
      workspaceId: WorkspaceId
      scope: string
      epochCapability: WorkspaceRuntimeEpochCapability
    },
    commit: (snapshot: WorkspacePaneTabsSnapshot) => undefined,
  ): Promise<void> {
    assertWorkspaceRuntimeEpochCapability(
      input.epochCapability,
      aggregateScope(input.userId, input.workspaceId, input.scope),
    )
    return await this.runWorkspaceTabsOperation(input.workspaceId, async (layout) => {
      const providers = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      const validTargets = await this.targetProjection.captureTargets(input.userId, input.workspaceId, input.scope)
      const snapshot = await layout.snapshot({
        scope: aggregateScope(input.userId, input.workspaceId, input.scope),
        validTargets,
        providerSnapshots: providers,
        epochCapability: input.epochCapability,
      })
      commit(snapshot)
    })
  }

  async closeScope(input: { userId: string; scope: string }): Promise<void> {
    const workspaceId = workspaceIdFromScope(input.scope)
    await this.runWorkspaceTabsOperation(workspaceId, (layout) => {
      layout.closeEpoch(aggregateScope(input.userId, workspaceId, input.scope))
    })
  }

  physicalWorktreeTargets(target: PhysicalWorktreeExecutionCapability | PhysicalWorktreeIdentity) {
    const indexTarget = 'identity' in target ? physicalWorktreeAdmissionLease(target) : target
    return this.layoutAggregate.physicalTargets(indexTarget).map((ref) => ({
      userId: ref.userId,
      scope: scopeFromAggregate(ref),
      target: ref.target,
      workspaceRuntimeId: ref.workspaceRuntimeId,
    }))
  }

  async clearPhysicalWorktreeIndex(capability: PhysicalWorktreeExecutionCapability): Promise<void> {
    const lease = physicalWorktreeAdmissionLease(capability)
    const workspaceIds = new Set(this.physicalWorktreeTargets(capability).map((ref) => ref.target.workspaceId))
    await Promise.all(
      [...workspaceIds].map(
        async (workspaceId) =>
          await this.runWorkspaceTabsOperation(workspaceId, (layout) => {
            layout.clearPhysicalIdentity(workspaceId, lease)
          }),
      ),
    )
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
    workspaceId: WorkspaceId
    scope: string
    epochCapability: WorkspaceRuntimeMembershipCapability
  }): Promise<WorkspacePaneTabsSnapshot> {
    const scope = aggregateScope(input.userId, input.workspaceId, input.scope)
    assertWorkspaceRuntimeEpochCapability(input.epochCapability, scope)
    const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
    const validTargets = await this.targetProjection.captureTargets(input.userId, input.workspaceId, input.scope)
    assertWorkspaceRuntimeEpochCapability(input.epochCapability, scope)
    const admissionSeed = await this.runWorkspaceTabsOperation(input.workspaceId, async (layout) => ({
      entries: await layout.projectEntriesForAdmission({
        scope: aggregateScope(input.userId, input.workspaceId, input.scope),
        validTargets,
        providerSnapshots,
      }),
      indexedLeases: layout.indexedAdmissionLeases(scope),
    }))
    const projectedCapabilities = await this.capturePhysicalWorktrees(
      input,
      workspaceRuntimeTabWorktreePaths({ entries: admissionSeed.entries, providerSnapshots }),
    )
    let lockTargets = uniqueSortedAdmissionLeases([
      ...projectedCapabilities.map(physicalWorktreeAdmissionLease),
      ...admissionSeed.indexedLeases,
    ])
    let validatedCapabilities = capabilitiesByIdentity(projectedCapabilities)
    for (;;) {
      let expandedLockTargets: PhysicalWorktreeAdmissionLease[] | null = null
      let expandedValidatedCapabilities: Map<string, PhysicalWorktreeExecutionCapability> | null = null
      const snapshot = await this.runWithPhysicalWorktrees(
        lockTargets,
        validatedCapabilities,
        async () =>
          await this.runWorkspaceTabsOperation(input.workspaceId, async (layout) => {
            assertWorkspaceRuntimeEpochCapability(input.epochCapability, scope)
            const currentProviders = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
            const currentTargets = await this.targetProjection.captureTargets(
              input.userId,
              input.workspaceId,
              input.scope,
            )
            const currentEntries = await layout.projectEntriesForAdmission({
              scope: aggregateScope(input.userId, input.workspaceId, input.scope),
              validTargets: currentTargets,
              providerSnapshots: currentProviders,
            })
            const projectedWorktreePaths = workspaceRuntimeTabWorktreePaths({
              entries: currentEntries,
              providerSnapshots: currentProviders,
            })
            const capturedWorktrees = await Promise.all(
              projectedWorktreePaths.map(async (worktreePath) => ({
                worktreePath,
                capability: await this.capturePhysicalWorktree(input, worktreePath),
              })),
            )
            const currentLockTargets = uniqueSortedAdmissionLeases([
              ...capturedWorktrees.map(({ capability }) => physicalWorktreeAdmissionLease(capability)),
              ...layout.indexedAdmissionLeases(scope),
            ])
            const admittedIdentities = new Set(lockTargets.map(physicalWorktreeAdmissionLeaseKey))
            const projectedIdentityKeys = new Set(
              capturedWorktrees.map(({ capability }) =>
                physicalWorktreeAdmissionLeaseKey(physicalWorktreeAdmissionLease(capability)),
              ),
            )
            if (
              currentLockTargets.some((target) => !admittedIdentities.has(physicalWorktreeAdmissionLeaseKey(target))) ||
              [...projectedIdentityKeys].some((key) => !validatedCapabilities.has(key))
            ) {
              expandedLockTargets = uniqueSortedAdmissionLeases([...lockTargets, ...currentLockTargets])
              expandedValidatedCapabilities = mergeCurrentCapabilities(
                validatedCapabilities,
                capturedWorktrees.map(({ capability }) => capability),
              )
              return null
            }
            assertWorkspaceRuntimeEpochCapability(input.epochCapability, scope)
            layout.commitProjectionTargets({
              ...scope,
              targets: currentEntries.map((entry) => {
                return requiredProjectionForRuntimeTarget(currentTargets, currentProviders, entry.target)
              }),
              physicalTargets: capturedWorktrees
                .filter(({ worktreePath }) => projectedWorktreePaths.includes(worktreePath))
                .flatMap(({ worktreePath, capability }) =>
                  currentEntries.flatMap((entry) => {
                    const projection = requiredProjectionForRuntimeTarget(
                      currentTargets,
                      currentProviders,
                      entry.target,
                    )
                    return projection.nativeWorktreePath === worktreePath
                      ? [{ target: projection.target, lease: physicalWorktreeAdmissionLease(capability) }]
                      : []
                  }),
                ),
              epochCapability: input.epochCapability,
            })
            return await layout.snapshot({
              scope,
              validTargets: currentTargets,
              providerSnapshots: currentProviders,
              epochCapability: input.epochCapability,
            })
          }),
      )
      if (snapshot) return snapshot
      if (!expandedLockTargets) throw new Error('workspace pane admission did not expand')
      lockTargets = expandedLockTargets
      validatedCapabilities = expandedValidatedCapabilities ?? validatedCapabilities
    }
  }

  private async capturePhysicalWorktrees(
    input: { userId: string; workspaceId: WorkspaceId; scope: string },
    worktreePaths: readonly string[],
  ): Promise<PhysicalWorktreeExecutionCapability[]> {
    return uniqueSortedCapabilities(
      await Promise.all(
        worktreePaths.map(async (worktreePath) => await this.capturePhysicalWorktree(input, worktreePath)),
      ),
    )
  }

  private async runAggregateCommand(
    input: {
      userId: string
      workspaceId: WorkspaceId
      scope: string
      epochCapability: WorkspaceRuntimeMembershipCapability
    },
    command: (
      layout: WorkspacePaneLayoutOperation,
      validTargets: readonly WorkspacePaneTargetProjection[],
      providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
      epochCapability: WorkspaceRuntimeEpochCapability,
    ) => Promise<WorkspacePaneLayoutCommitResult>,
  ): Promise<WorkspacePaneTabsCommandResult> {
    return await this.runWorkspaceTabsOperation(input.workspaceId, async (layout) => {
      const scope = aggregateScope(input.userId, input.workspaceId, input.scope)
      assertWorkspaceRuntimeEpochCapability(input.epochCapability, scope)
      const validTargets = await this.targetProjection.captureTargets(input.userId, input.workspaceId, input.scope)
      const providers = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      assertWorkspaceRuntimeEpochCapability(input.epochCapability, scope)
      const result = await command(layout, validTargets, providers, input.epochCapability)
      if (!result.projectionCurrent) {
        return { ...result, kind: 'committed-projection-failed', error: new WorkspaceRuntimeStaleError() }
      }
      try {
        const resampled = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
        const resampledTargets = await this.targetProjection.captureTargets(
          input.userId,
          input.workspaceId,
          input.scope,
        )
        assertWorkspaceRuntimeEpochCapability(input.epochCapability, scope)
        const snapshot = await layout.snapshot({
          scope,
          validTargets: resampledTargets,
          providerSnapshots: resampled,
          epochCapability: input.epochCapability,
        })
        return { ...result, kind: 'projected', snapshot }
      } catch (error) {
        return { ...result, kind: 'committed-projection-failed', error }
      }
    })
  }

  private async capturePhysicalWorktree(
    input: { userId: string; workspaceId: WorkspaceId; scope: string },
    worktreePath: string,
  ): Promise<PhysicalWorktreeExecutionCapability> {
    return await this.physicalWorktrees.capture({
      userId: input.userId,
      workspaceId: input.workspaceId,
      workspaceRuntimeId: workspaceRuntimeIdFromScope(input.scope),
      worktreePath,
    })
  }

  private async runWithPhysicalWorktrees<T>(
    lockTargets: readonly PhysicalWorktreeAdmissionLease[],
    validatedCapabilities: ReadonlyMap<string, PhysicalWorktreeExecutionCapability>,
    task: () => Promise<T>,
  ): Promise<T> {
    const result = await this.worktreeOperations.runAdmissionBatch(
      admissionRecords(lockTargets, [...validatedCapabilities.values()]),
      task,
    )
    if (!result.admitted) throw new Error('error.worktree-removal-in-progress')
    return result.value
  }

  private async runWorkspaceTabsOperation<T>(
    workspaceId: WorkspaceId,
    task: (operation: WorkspacePaneLayoutOperation) => Promise<T> | T,
  ): Promise<T> {
    return await this.layoutAggregate.runExclusive(workspaceId, task)
  }
}

function providerSnapshotsWithPendingSession(
  snapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
  session: WorkspacePaneRuntimeTabsLiveSession & { type: WorkspacePaneRuntimeTabType },
): WorkspacePaneRuntimeTabsProviderSnapshot[] {
  let matched = false
  const next = snapshots.map((snapshot) => {
    if (snapshot.type !== session.type) return snapshot
    matched = true
    return {
      ...snapshot,
      liveSessions: [
        ...snapshot.liveSessions.filter((candidate) => candidate.sessionId !== session.sessionId),
        session,
      ],
    }
  })
  if (!matched) next.push({ type: session.type, revision: 0, liveSessions: [session] })
  return next
}

function isWorkspacePaneWorktreeTarget(
  target: WorkspacePaneTargetProjection,
): target is WorkspacePaneTargetProjection & { nativeWorktreePath: string } {
  return target.nativeWorktreePath !== null
}

function runtimeTargetKey(target: RuntimeWorkspacePaneTarget): string {
  const key = runtimeWorkspacePaneTargetKey(target)
  if (!key) throw new Error('error.workspace-tabs-target-invalid')
  return key
}

function projectionKey(projection: WorkspacePaneTargetProjection): string {
  return runtimeTargetKey(projection.target)
}

function requiredProjectionForRuntimeTarget(
  projections: readonly WorkspacePaneTargetProjection[],
  providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
  target: RuntimeWorkspacePaneTarget,
): WorkspacePaneTargetProjection {
  const key = runtimeTargetKey(target)
  const projection = projections.find((candidate) => projectionKey(candidate) === key)
  if (projection) return projection
  const session = providers
    .flatMap((provider) => provider.liveSessions)
    .find((candidate) => runtimeTargetKey(candidate.target) === key)
  if (!session) throw new Error('error.workspace-tabs-target-invalid')
  return {
    target: session.target,
    nativeWorktreePath: session.worktreePath,
  }
}

function workspaceRuntimeIdFromScope(scope: string): string {
  const separator = scope.lastIndexOf('\0')
  if (separator < 0 || separator === scope.length - 1) throw new Error('invalid workspace pane runtime scope')
  return scope.slice(separator + 1)
}

function workspaceIdFromScope(scope: string): WorkspaceId {
  const separator = scope.lastIndexOf('\0')
  if (separator < 1) throw new Error('invalid workspace pane runtime scope')
  const workspaceId = canonicalWorkspaceLocator(scope.slice(0, separator))
  if (!workspaceId) throw new Error('invalid workspace pane runtime scope')
  return workspaceId
}

function aggregateScope(userId: string, workspaceId: WorkspaceId, scope: string) {
  return { userId, workspaceId, workspaceRuntimeId: workspaceRuntimeIdFromScope(scope) }
}

function scopeFromAggregate(scope: { workspaceId: WorkspaceId; workspaceRuntimeId: string }): string {
  return `${scope.workspaceId}\0${scope.workspaceRuntimeId}`
}

function assertUniqueRuntimeProviderTypes(providers: readonly WorkspacePaneRuntimeTabsProvider[]): void {
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
