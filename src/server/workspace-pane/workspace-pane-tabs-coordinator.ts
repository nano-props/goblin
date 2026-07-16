import type {
  WorkspacePaneRuntimeTabType,
  WorkspacePaneTabEntry,
} from '#/shared/workspace-pane.ts'
import { isWorkspacePaneStaticTabType, workspacePaneTabsWithRuntimeTab } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateOperation,
} from '#/shared/workspace-pane-tabs.ts'
import type { WorkspacePaneTabsTargetIdentity } from '#/shared/workspace-pane-tabs-target.ts'
import {
  workspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type {
  PhysicalWorktreeOperationCoordinator,
  PhysicalWorktreeOperationPermit,
} from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  physicalWorktreeIdentityKey,
  type PhysicalWorktreeIdentity,
} from '#/server/worktree-removal/physical-worktree-identity.ts'
import {
  physicalWorktreeAdmissionLease,
  physicalWorktreeAdmissionLeaseKey,
  type PhysicalWorktreeAdmissionLease,
  type PhysicalWorktreeExecutionCapability,
  type PhysicalWorktreeIdentityResolver,
} from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'

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

export interface WorkspacePaneRuntimeTabsLiveSession {
  sessionId: string
  branch: string
  worktreePath: string
}

interface WorkspacePaneWorktreeTarget extends WorkspacePaneTabsTarget {
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
  captureTargets(userId: string, repoRoot: string, scope: string): Promise<readonly WorkspacePaneTabsTarget[]>
}

export interface WorkspacePaneTabsCommandResult extends WorkspacePaneLayoutCommitResult {
  snapshot: WorkspacePaneTabsSnapshot
}

export type WorkspacePaneRuntimeTabCommitResult =
  | { kind: 'committed'; snapshot: WorkspacePaneTabsSnapshot; terminalSessionsRevision: number | null }
  | { kind: 'runtime-stale' }

export interface WorkspacePaneTabsCoordinatorOptions {
  runtimeProviders: readonly WorkspacePaneRuntimeTabsProvider[]
  worktreeOperations: PhysicalWorktreeOperationCoordinator
  physicalWorktrees: Pick<PhysicalWorktreeIdentityResolver, 'capture'>
  layoutAggregate: WorkspacePaneLayoutAggregate
  targetProjection: WorkspacePaneTargetProjectionProvider
}

export class WorkspacePaneTabsCoordinator {
  private readonly runtimeProviders: readonly WorkspacePaneRuntimeTabsProvider[]
  private readonly worktreeOperations: PhysicalWorktreeOperationCoordinator
  private readonly physicalWorktrees: Pick<PhysicalWorktreeIdentityResolver, 'capture'>
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

  async ensureRuntimeTabForSession(input: {
    userId: string
    repoRoot: string
    scope: string
    branchName: string
    worktreePath: string
    runtimeType: WorkspacePaneRuntimeTabType
    sessionId: string
    insertAfterIdentity?: string | null
    permit: PhysicalWorktreeOperationPermit
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability
    isRuntimeCurrent: () => boolean
    publishRuntime?: () => number
  }): Promise<WorkspacePaneRuntimeTabCommitResult> {
    const physicalCapability = input.physicalWorktreeCapability
    return await this.runWorkspaceTabsRepoOperation(input.repoRoot, async (layout) => {
      this.worktreeOperations.assertPermit(physicalCapability, input.permit)
      const capturedTargets = await this.targetProjection.captureTargets(input.userId, input.repoRoot, input.scope)
      const requestedTarget = {
        repoRoot: input.repoRoot,
        branchName: input.branchName,
        worktreePath: input.worktreePath,
      }
      const requestedTargetKey = workspacePaneTabsTargetIdentityKey(requestedTarget)
      const validTargets = capturedTargets.some(
        (target) => workspacePaneTabsTargetIdentityKey(target) === requestedTargetKey,
      )
        ? capturedTargets
        : [...capturedTargets, requestedTarget]
      const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      if (!input.isRuntimeCurrent()) return { kind: 'runtime-stale' }
      this.worktreeOperations.assertPermit(physicalCapability, input.permit)
      const scope = aggregateScope(input.userId, input.repoRoot, input.scope)
      const current = await layout.snapshot({ scope, validTargets, providerSnapshots })
      const entry = current.entries.find((candidate) => candidate.worktreePath === input.worktreePath)
      const tabs = workspacePaneTabsWithRuntimeTab(
        entry?.tabs ?? [workspacePaneStaticTabEntry('status')],
        input.runtimeType,
        input.sessionId,
        { insertAfterIdentity: input.insertAfterIdentity ?? null },
      )
      const targetIdentity = { kind: 'worktree' as const, repoRoot: input.repoRoot, worktreePath: input.worktreePath }
      layout.commitRuntimeTarget({
        ...scope,
        target: targetIdentity,
        lease: physicalWorktreeAdmissionLease(physicalCapability),
        tabs,
      })
      const terminalSessionsRevision = input.publishRuntime?.() ?? null
      const resampled = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      const resampledTargets = await this.targetProjection.captureTargets(input.userId, input.repoRoot, input.scope)
      const snapshot = await layout.snapshot({ scope, validTargets: resampledTargets, providerSnapshots: resampled })
      return {
        kind: 'committed',
        snapshot,
        terminalSessionsRevision,
      }
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
  }): Promise<WorkspacePaneTabsCommandResult> {
    if (input.worktreePath === null) {
      return await this.runAggregateCommand(input, async (layout, validTargets, providerSnapshots) => {
        return await layout.replace({
          ...aggregateScope(input.userId, input.repoRoot, input.scope),
          branchName: input.branchName,
          worktreePath: null,
          tabs: input.tabs,
          validTargets,
          providerSnapshots,
          assertCurrent: input.assertCurrent,
        })
      })
    }
    const worktreePath = input.worktreePath
    const physicalCapability = await this.capturePhysicalWorktree(input, worktreePath)
    const result = await this.worktreeOperations.runOperation(physicalCapability, async () =>
      await this.runAggregateCommand(input, async (layout, validTargets, providerSnapshots) =>
        await layout.replace({
          ...aggregateScope(input.userId, input.repoRoot, input.scope),
          branchName: input.branchName,
          worktreePath,
          tabs: input.tabs,
          validTargets,
          providerSnapshots,
          physicalWorktreeLease: physicalWorktreeAdmissionLease(physicalCapability),
          assertCurrent: input.assertCurrent,
        })))
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
  }): Promise<WorkspacePaneLayoutValidationResult> {
    const worktreeTargets = input.targets.filter(isWorkspacePaneWorktreeTarget)
    const capturedWorktrees = await Promise.all(worktreeTargets.map(async (target) => ({
      target,
      capability: await this.capturePhysicalWorktree(input, target.worktreePath),
    })))
    const scope = aggregateScope(input.userId, input.repoRoot, input.scope)
    const indexedLeases = await this.runWorkspaceTabsRepoOperation(input.repoRoot, (layout) =>
      layout.indexedAdmissionLeases(scope))
    let lockTargets = uniqueSortedAdmissionLeases([
      ...capturedWorktrees.map(({ capability }) => physicalWorktreeAdmissionLease(capability)),
      ...indexedLeases,
    ])
    const validatedCapabilities = capabilitiesByIdentity(capturedWorktrees.map(({ capability }) => capability))
    for (;;) {
      let expandedLockTargets: PhysicalWorktreeAdmissionLease[] | null = null
      const result = await this.runWithPhysicalWorktrees(lockTargets, validatedCapabilities, async () =>
        await this.runWorkspaceTabsRepoOperation(input.repoRoot, async (layout) => {
          const requiredLockTargets = uniqueSortedAdmissionLeases([
            ...capturedWorktrees.map(({ capability }) => physicalWorktreeAdmissionLease(capability)),
            ...layout.indexedAdmissionLeases(scope),
          ])
          const admittedIdentities = new Set(
            lockTargets.map(physicalWorktreeAdmissionLeaseKey),
          )
          if (requiredLockTargets.some(
            (target) => !admittedIdentities.has(physicalWorktreeAdmissionLeaseKey(target)),
          )) {
            expandedLockTargets = uniqueSortedAdmissionLeases([...lockTargets, ...requiredLockTargets])
            return null
          }
          input.assertCurrent()
          const providers = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
          input.assertCurrent()
          return await layout.validateMembershipAndSnapshot({
            ...scope,
            validTargets: input.targets,
            physicalTargets: capturedWorktrees.map(({ target, capability }) => ({
              target: { kind: 'worktree' as const, repoRoot: input.repoRoot, worktreePath: target.worktreePath },
              lease: physicalWorktreeAdmissionLease(capability),
            })),
            expectedRepoEntry: input.expectedRepoEntry,
            providerSnapshots: providers,
            assertCurrent: input.assertCurrent,
          })
        }))
      if (result) return result
      if (!expandedLockTargets) throw new Error('workspace pane restore admission did not expand')
      lockTargets = expandedLockTargets
    }
  }

  async updateTabs(input: {
    userId: string
    repoRoot: string
    scope: string
    branchName: string
    worktreePath: string | null
    operation: WorkspacePaneTabsUpdateOperation
    assertCurrent: () => void
  }): Promise<WorkspacePaneTabsCommandResult> {
    if (input.worktreePath === null) {
      return await this.runAggregateCommand(input, async (layout, validTargets, providerSnapshots) => {
        return await layout.update({
          ...aggregateScope(input.userId, input.repoRoot, input.scope),
          branchName: input.branchName,
          worktreePath: null,
          operation: input.operation,
          validTargets,
          providerSnapshots,
          assertCurrent: input.assertCurrent,
        })
      })
    }
    const worktreePath = input.worktreePath
    const physicalCapability = await this.capturePhysicalWorktree(input, worktreePath)
    const result = await this.worktreeOperations.runOperation(physicalCapability, async () =>
      await this.runAggregateCommand(input, async (layout, validTargets, providerSnapshots) =>
        await layout.update({
          ...aggregateScope(input.userId, input.repoRoot, input.scope),
          branchName: input.branchName,
          worktreePath,
          operation: input.operation,
          validTargets,
          providerSnapshots,
          physicalWorktreeLease: physicalWorktreeAdmissionLease(physicalCapability),
          assertCurrent: input.assertCurrent,
        })))
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
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability
    permit: PhysicalWorktreeOperationPermit
    assertCurrent?: () => void
  }): Promise<WorkspacePaneTabsSnapshot> {
    this.worktreeOperations.assertPermit(input.physicalWorktreeCapability, input.permit)
    return await this.runWorkspaceTabsRepoOperation(input.repoRoot, async (layout) => {
      const providerSnapshots = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      const validTargets = await this.targetProjection.captureTargets(input.userId, input.repoRoot, input.scope)
      input.assertCurrent?.()
      this.worktreeOperations.assertPermit(input.physicalWorktreeCapability, input.permit)
      input.assertCurrent?.()
      return await layout.snapshot({
        scope: aggregateScope(input.userId, input.repoRoot, input.scope),
        validTargets,
        providerSnapshots,
      })
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
    return await this.runWorkspaceTabsRepoOperation(input.repoRoot, async (layout) => {
      const providers = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      const validTargets = await this.targetProjection.captureTargets(input.userId, input.repoRoot, input.scope)
      return await layout.snapshot({
        scope: aggregateScope(input.userId, input.repoRoot, input.scope),
        validTargets,
        providerSnapshots: providers,
      })
    })
  }

  async closeScope(input: { userId: string; scope: string }): Promise<void> {
    const repoRoot = repoRootFromScope(input.scope)
    await this.runWorkspaceTabsRepoOperation(repoRoot, (layout) => {
      layout.closeEpoch(aggregateScope(input.userId, repoRoot, input.scope))
    })
  }

  async closeInvalidatedScope(input: { userId: string; scope: string }): Promise<void> {
    await this.closeScope(input)
  }

  physicalWorktreeTargets(target: PhysicalWorktreeExecutionCapability | PhysicalWorktreeIdentity) {
    const indexTarget = 'identity' in target ? physicalWorktreeAdmissionLease(target) : target
    return this.layoutAggregate.physicalTargets(indexTarget).map((ref) => ({
      userId: ref.userId,
      scope: scopeFromAggregate(ref),
      target: ref.target,
      repoRuntimeId: ref.repoRuntimeId,
    }))
  }

  async clearPhysicalWorktreeIndex(capability: PhysicalWorktreeExecutionCapability): Promise<void> {
    const lease = physicalWorktreeAdmissionLease(capability)
    const repoRoots = new Set(this.physicalWorktreeTargets(capability).map((ref) => ref.target.repoRoot))
    await Promise.all([...repoRoots].map(async (repoRoot) =>
      await this.runWorkspaceTabsRepoOperation(repoRoot, (layout) => {
        layout.clearPhysicalIdentity(repoRoot, lease)
      })))
  }

  async reconcilePhysicalWorktreeAfterRemovalFailure(input: {
    repoRoot: string
    worktreePath: string
    physicalWorktreeCapability: PhysicalWorktreeExecutionCapability
    permit: PhysicalWorktreeOperationPermit
    scopes: readonly { userId: string; repoRoot: string; scope: string; worktreePath: string }[]
  }): Promise<void> {
    await Promise.all(
      input.scopes.map(async ({ userId, repoRoot, scope, worktreePath }) => {
        await this.reconcileWorktreeAdmitted({
          userId,
          repoRoot,
          scope,
          worktreePath,
          physicalWorktreeCapability: input.physicalWorktreeCapability,
          permit: input.permit,
        })
      }),
    )
  }

  async closeUser(input: { userId: string }): Promise<void> {
    await Promise.all(this.layoutAggregate.epochsForUser(input.userId).map(async (scope) => {
      await this.closeScope({ userId: scope.userId, scope: scopeFromAggregate(scope) })
    }))
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
    const validTargets = await this.targetProjection.captureTargets(input.userId, input.repoRoot, input.scope)
    input.assertCurrent()
    const scope = aggregateScope(input.userId, input.repoRoot, input.scope)
    const admissionSeed = await this.runWorkspaceTabsRepoOperation(input.repoRoot, async (layout) => ({
      entries: await layout.projectEntriesForAdmission({
        scope: aggregateScope(input.userId, input.repoRoot, input.scope),
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
      const snapshot = await this.runWithPhysicalWorktrees(lockTargets, validatedCapabilities, async () =>
        await this.runWorkspaceTabsRepoOperation(input.repoRoot, async (layout) => {
          input.assertCurrent()
          const currentProviders = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
          const currentTargets = await this.targetProjection.captureTargets(input.userId, input.repoRoot, input.scope)
          const currentEntries = await layout.projectEntriesForAdmission({
            scope: aggregateScope(input.userId, input.repoRoot, input.scope),
            validTargets: currentTargets,
            providerSnapshots: currentProviders,
          })
          const projectedWorktreePaths = workspaceRuntimeTabWorktreePaths({
            entries: currentEntries,
            providerSnapshots: currentProviders,
          })
          const capturedWorktrees = await Promise.all(projectedWorktreePaths.map(async (worktreePath) => ({
            worktreePath,
            capability: await this.capturePhysicalWorktree(input, worktreePath),
          })))
          const currentLockTargets = uniqueSortedAdmissionLeases([
            ...capturedWorktrees.map(({ capability }) => physicalWorktreeAdmissionLease(capability)),
            ...layout.indexedAdmissionLeases(scope),
          ])
          const admittedIdentities = new Set(lockTargets.map(physicalWorktreeAdmissionLeaseKey))
          const projectedIdentityKeys = new Set(
            capturedWorktrees.map(({ capability }) =>
              physicalWorktreeAdmissionLeaseKey(physicalWorktreeAdmissionLease(capability))),
          )
          if (currentLockTargets.some((target) => !admittedIdentities.has(physicalWorktreeAdmissionLeaseKey(target))) ||
            [...projectedIdentityKeys].some((key) => !validatedCapabilities.has(key))) {
            expandedLockTargets = uniqueSortedAdmissionLeases([...lockTargets, ...currentLockTargets])
            expandedValidatedCapabilities = mergeCurrentCapabilities(
              validatedCapabilities,
              capturedWorktrees.map(({ capability }) => capability),
            )
            return null
          }
          input.assertCurrent()
          layout.commitProjectionTargets({
            ...scope,
            targets: currentEntries.map(({ repoRoot, branchName, worktreePath }) => ({
              repoRoot,
              branchName,
              worktreePath,
            })),
            physicalTargets: capturedWorktrees
              .filter(({ worktreePath }) => projectedWorktreePaths.includes(worktreePath))
              .map(({ worktreePath, capability }) => ({
              target: { kind: 'worktree' as const, repoRoot: input.repoRoot, worktreePath },
              lease: physicalWorktreeAdmissionLease(capability),
              })),
          })
          return await layout.snapshot({
            scope,
            validTargets: currentTargets,
            providerSnapshots: currentProviders,
          })
        }))
      if (snapshot) return snapshot
      if (!expandedLockTargets) throw new Error('workspace pane admission did not expand')
      lockTargets = expandedLockTargets
      validatedCapabilities = expandedValidatedCapabilities ?? validatedCapabilities
    }
  }

  private async capturePhysicalWorktrees(
    input: { userId: string; repoRoot: string; scope: string },
    worktreePaths: readonly string[],
  ): Promise<PhysicalWorktreeExecutionCapability[]> {
    return uniqueSortedCapabilities(await Promise.all(
      worktreePaths.map(async (worktreePath) => await this.capturePhysicalWorktree(input, worktreePath)),
    ))
  }

  private async runAggregateCommand(
    input: { userId: string; repoRoot: string; scope: string; assertCurrent?: () => void },
    command: (
      layout: WorkspacePaneLayoutOperation,
      validTargets: readonly WorkspacePaneTabsTarget[],
      providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
    ) => Promise<WorkspacePaneLayoutCommitResult>,
  ): Promise<WorkspacePaneTabsCommandResult> {
    return await this.runWorkspaceTabsRepoOperation(input.repoRoot, async (layout) => {
      input.assertCurrent?.()
      const validTargets = await this.targetProjection.captureTargets(input.userId, input.repoRoot, input.scope)
      const providers = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      input.assertCurrent?.()
      const result = await command(layout, validTargets, providers)
      const resampled = await this.runtimeProviderSnapshotsForScope(input.userId, input.scope)
      const resampledTargets = await this.targetProjection.captureTargets(input.userId, input.repoRoot, input.scope)
      input.assertCurrent?.()
      const snapshot = await layout.snapshot({
        scope: aggregateScope(input.userId, input.repoRoot, input.scope),
        validTargets: resampledTargets,
        providerSnapshots: resampled,
      })
      return { ...result, snapshot }
    })
  }

  private async capturePhysicalWorktree(
    input: { userId: string; repoRoot: string; scope: string },
    worktreePath: string,
  ): Promise<PhysicalWorktreeExecutionCapability> {
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

  private async runWorkspaceTabsRepoOperation<T>(
    repoRoot: string,
    task: (operation: WorkspacePaneLayoutOperation) => Promise<T> | T,
  ): Promise<T> {
    return await this.layoutAggregate.runExclusive(repoRoot, task)
  }
}

function uniqueSortedCapabilities(
  capabilities: readonly PhysicalWorktreeExecutionCapability[],
): PhysicalWorktreeExecutionCapability[] {
  return Array.from(new Map(
    [...capabilities]
      .sort((a, b) => physicalWorktreeAdmissionLeaseKey(physicalWorktreeAdmissionLease(a))
        .localeCompare(physicalWorktreeAdmissionLeaseKey(physicalWorktreeAdmissionLease(b))))
      .map((capability) => [physicalWorktreeAdmissionLeaseKey(physicalWorktreeAdmissionLease(capability)), capability]),
  ).values())
}

function uniqueSortedAdmissionLeases(
  leases: readonly PhysicalWorktreeAdmissionLease[],
): PhysicalWorktreeAdmissionLease[] {
  return Array.from(new Map(
    [...leases]
      .sort((a, b) => physicalWorktreeAdmissionLeaseKey(a).localeCompare(physicalWorktreeAdmissionLeaseKey(b)))
      .map((lease) => [physicalWorktreeAdmissionLeaseKey(lease), lease]),
  ).values())
}

function capabilitiesByIdentity(
  capabilities: readonly PhysicalWorktreeExecutionCapability[],
): Map<string, PhysicalWorktreeExecutionCapability> {
  return new Map(capabilities.map((capability) => [
    physicalWorktreeAdmissionLeaseKey(physicalWorktreeAdmissionLease(capability)),
    capability,
  ]))
}

function mergeCurrentCapabilities(
  existing: ReadonlyMap<string, PhysicalWorktreeExecutionCapability>,
  current: readonly PhysicalWorktreeExecutionCapability[],
): Map<string, PhysicalWorktreeExecutionCapability> {
  const currentStableKeys = new Set(current.map((capability) => physicalWorktreeIdentityKey(capability.identity)))
  return new Map([
    ...[...existing].filter(([, capability]) => !currentStableKeys.has(physicalWorktreeIdentityKey(capability.identity))),
    ...capabilitiesByIdentity(current),
  ])
}

function admissionRecords(
  leases: readonly PhysicalWorktreeAdmissionLease[],
  capabilities: readonly PhysicalWorktreeExecutionCapability[],
) {
  const byStableIdentity = new Map<string, {
    identity: PhysicalWorktreeIdentity
    currentCapability: PhysicalWorktreeExecutionCapability | null
    indexedLeases: PhysicalWorktreeAdmissionLease[]
  }>()
  for (const lease of leases) {
    const key = physicalWorktreeIdentityKey(lease.identity)
    const record = byStableIdentity.get(key) ?? {
      identity: lease.identity,
      currentCapability: null,
      indexedLeases: [],
    }
    record.indexedLeases.push(lease)
    byStableIdentity.set(key, record)
  }
  for (const capability of capabilities) {
    const lease = physicalWorktreeAdmissionLease(capability)
    const key = physicalWorktreeIdentityKey(capability.identity)
    const record = byStableIdentity.get(key) ?? {
      identity: capability.identity,
      currentCapability: null,
      indexedLeases: [],
    }
    if (record.currentCapability &&
      physicalWorktreeAdmissionLeaseKey(physicalWorktreeAdmissionLease(record.currentCapability)) !==
      physicalWorktreeAdmissionLeaseKey(lease)) {
      throw new Error('error.ambiguous-worktree-execution-capability')
    }
    record.currentCapability = capability
    byStableIdentity.set(key, record)
  }
  return [...byStableIdentity.values()]
}

function isWorkspacePaneWorktreeTarget(target: WorkspacePaneTabsTarget): target is WorkspacePaneWorktreeTarget {
  return target.worktreePath !== null
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
