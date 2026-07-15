import PQueue from 'p-queue'
import {
  isWorkspacePaneRuntimeTabEntry,
  workspacePaneRuntimeTabEntry,
  workspacePaneStaticTabEntry,
  type WorkspacePaneStaticTabEntry,
  type WorkspacePaneTabEntry,
  type WorkspacePaneRuntimeTabType,
} from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneDurableLayout,
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateOperation,
} from '#/shared/workspace-pane-tabs.ts'
import {
  workspacePaneTabsTargetIdentityKey,
  workspacePaneTabsTargetIdentityKeyFromIdentity,
  type WorkspacePaneTabsTarget,
  type WorkspacePaneTabsTargetIdentity,
} from '#/shared/workspace-pane-tabs-target.ts'
import { workspacePaneTabsWithUpdateOperation } from '#/server/workspace-pane/workspace-pane-tabs-operations.ts'
import {
  projectRuntimePlacements,
  providerRevisionMap,
  WorkspacePaneEpochOverlay,
  type WorkspacePaneEpochScope,
} from '#/server/workspace-pane/workspace-pane-epoch-overlay.ts'
import {
  normalizeWorkspacePaneDurableLayout,
  type WorkspacePaneLayoutRepository,
} from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import type { WorkspacePaneRuntimeTabsProviderSnapshot } from '#/server/workspace-pane/workspace-pane-runtime-tabs-projection.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { PhysicalWorktreeIdentity } from '#/server/worktree-removal/physical-worktree-identity.ts'
import type { PhysicalWorktreeAdmissionLease } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import type { WorkspacePaneLayoutRestoreTransaction } from '#/server/workspace-pane/workspace-pane-layout-restore-transaction.ts'

const MAX_LAYOUT_CAS_RETRIES = 3

interface CanonicalClockState {
  layoutToken: string
  overlayRevision: number
  targetProjectionToken: string
  providerRevisions: Map<string, number>
  entriesToken: string
  revision: number
}

export type WorkspacePaneLayoutValidationResult =
  | {
      kind: 'validated'
      snapshot: WorkspacePaneTabsSnapshot
      affectedUserIds: string[]
    }
  | { kind: 'membership-conflict' }

export interface WorkspacePaneLayoutCommitResult {
  affectedUserIds: string[]
}

type WorkspacePaneLayoutMutationTarget =
  | { branchName: string; worktreePath: null; physicalWorktreeLease?: never }
  | { branchName: string; worktreePath: string; physicalWorktreeLease: PhysicalWorktreeAdmissionLease }

export type WorkspacePaneLayoutReplaceInput = WorkspacePaneEpochScope & WorkspacePaneLayoutMutationTarget & {
  tabs: readonly WorkspacePaneTabEntry[]
  validTargets: readonly WorkspacePaneTabsTarget[]
  providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
  assertCurrent?: () => void
}

export type WorkspacePaneLayoutUpdateInput = WorkspacePaneEpochScope & WorkspacePaneLayoutMutationTarget & {
  operation: WorkspacePaneTabsUpdateOperation
  validTargets: readonly WorkspacePaneTabsTarget[]
  providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
  assertCurrent?: () => void
}

export type WorkspacePaneLayoutRetireInput = WorkspacePaneEpochScope & {
  target: WorkspacePaneTabsTargetIdentity
  assertCurrent?: () => void
}

export interface WorkspacePaneLayoutSnapshotInput {
  scope: WorkspacePaneEpochScope
  validTargets: readonly WorkspacePaneTabsTarget[]
  providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
  knownLayout?: WorkspacePaneDurableLayout
}

export type WorkspacePaneLayoutValidationInput = WorkspacePaneEpochScope & {
  validTargets: readonly WorkspacePaneTabsTarget[]
  physicalTargets: readonly { target: WorkspacePaneTabsTargetIdentity; lease: PhysicalWorktreeAdmissionLease }[]
  expectedRepoEntry: RepoSessionEntry
  providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
  assertCurrent?: () => void
}

export interface WorkspacePaneLayoutOperation {
  replace(input: WorkspacePaneLayoutReplaceInput): Promise<WorkspacePaneLayoutCommitResult>
  update(input: WorkspacePaneLayoutUpdateInput): Promise<WorkspacePaneLayoutCommitResult>
  retire(input: WorkspacePaneLayoutRetireInput & { validTargets?: readonly WorkspacePaneTabsTarget[] }): Promise<WorkspacePaneLayoutCommitResult>
  snapshot(input: WorkspacePaneLayoutSnapshotInput): Promise<WorkspacePaneTabsSnapshot>
  projectEntriesForAdmission(input: WorkspacePaneLayoutSnapshotInput): Promise<WorkspacePaneTabsSnapshot['entries']>
  validateRepairAndSnapshot(input: WorkspacePaneLayoutValidationInput): Promise<WorkspacePaneLayoutValidationResult>
  commitRuntimeTarget(input: WorkspacePaneEpochScope & {
    target: WorkspacePaneTabsTargetIdentity
    lease: PhysicalWorktreeAdmissionLease
    tabs: readonly WorkspacePaneTabEntry[]
  }): void
  closeEpoch(scope: WorkspacePaneEpochScope): void
  commitProjectionTargets(input: WorkspacePaneEpochScope & {
    targets: readonly WorkspacePaneTabsTarget[]
    physicalTargets: readonly { target: WorkspacePaneTabsTargetIdentity; lease: PhysicalWorktreeAdmissionLease }[]
  }): void
  indexedAdmissionLeases(scope: WorkspacePaneEpochScope): PhysicalWorktreeAdmissionLease[]
}

export class WorkspacePaneLayoutAggregate {
  private readonly repository: WorkspacePaneLayoutRepository
  private readonly restoreTransaction: WorkspacePaneLayoutRestoreTransaction
  private readonly overlay: WorkspacePaneEpochOverlay
  private readonly clocks = new Map<string, CanonicalClockState>()
  private readonly operationQueuesByRepoRoot = new Map<string, PQueue>()

  constructor(options: {
    repository: WorkspacePaneLayoutRepository
    restoreTransaction: WorkspacePaneLayoutRestoreTransaction
    overlay?: WorkspacePaneEpochOverlay
  }) {
    this.repository = options.repository
    this.restoreTransaction = options.restoreTransaction
    this.overlay = options.overlay ?? new WorkspacePaneEpochOverlay()
  }

  async runExclusive<T>(
    repoRoot: string,
    task: (operation: WorkspacePaneLayoutOperation) => Promise<T> | T,
  ): Promise<T> {
    let queue = this.operationQueuesByRepoRoot.get(repoRoot)
    if (!queue) {
      queue = new PQueue({ concurrency: 1 })
      this.operationQueuesByRepoRoot.set(repoRoot, queue)
    }
    try {
      return await queue.add(() => task({
        replace: async (input) => await this.replace(input),
        update: async (input) => await this.update(input),
        retire: async (input) => await this.retire(input),
        snapshot: async (input) => await this.snapshot(input),
        projectEntriesForAdmission: async (input) => await this.projectEntriesForAdmission(input),
        validateRepairAndSnapshot: async (input) => await this.validateRepairAndSnapshot(input),
        commitRuntimeTarget: (input) => this.commitRuntimeTarget(input),
        closeEpoch: (scope) => this.closeEpoch(scope),
        commitProjectionTargets: (input) => this.commitProjectionTargets(input),
        indexedAdmissionLeases: (scope) => this.overlay.indexedAdmissionLeases(scope),
      }))
    } finally {
      void queue.onIdle().then(() => {
        if (this.operationQueuesByRepoRoot.get(repoRoot) !== queue) return
        if (queue.size === 0 && queue.pending === 0) this.operationQueuesByRepoRoot.delete(repoRoot)
      })
    }
  }

  private async replace(input: WorkspacePaneLayoutReplaceInput): Promise<WorkspacePaneLayoutCommitResult> {
    return await this.mutate(input, () => [...input.tabs], { retryConflicts: false })
  }

  private async update(input: WorkspacePaneLayoutUpdateInput): Promise<WorkspacePaneLayoutCommitResult> {
    return await this.mutate(input, (current) => workspacePaneTabsWithUpdateOperation(current, input.operation), {
      retryConflicts: true,
    })
  }

  private async retire(input: WorkspacePaneLayoutRetireInput & { validTargets?: readonly WorkspacePaneTabsTarget[] }): Promise<WorkspacePaneLayoutCommitResult> {
    for (let conflicts = 0; ; conflicts += 1) {
      input.assertCurrent?.()
      const current = await this.repository.load(input.repoRoot)
      input.assertCurrent?.()
      const targetKey = workspacePaneTabsTargetIdentityKeyFromIdentity(input.target)
      if (input.validTargets && input.validTargets.some((target) => workspacePaneTabsTargetIdentityKey(target) === targetKey)) {
        return this.commitResult(input, false, [])
      }
      const replacement = {
        entries: current.layout.entries.filter((entry) => workspacePaneTabsTargetIdentityKey(entry) !== targetKey),
      }
      const outcome = await this.repository.compareAndSwap({
        repoRoot: input.repoRoot,
        expected: current.layout,
        replacement,
      })
      if (outcome.kind === 'write-failure') throw outcome.error
      if (outcome.kind === 'conflict' && conflicts < MAX_LAYOUT_CAS_RETRIES) continue
      if (outcome.kind !== 'accepted') throw new Error('error.workspace-tabs-layout-conflict')
      const affectedScopes = this.overlay.retireTarget(input.target)
      return this.commitResult(input, outcome.changed, [
        ...affectedScopes.map((scope) => scope.userId),
      ])
    }
  }

  private async snapshot(input: WorkspacePaneLayoutSnapshotInput): Promise<WorkspacePaneTabsSnapshot> {
    const { scope, validTargets, providerSnapshots, knownLayout } = input
    this.overlay.activate(scope)
    const layout = knownLayout ?? (await this.repository.load(scope.repoRoot)).layout
    const entries = this.projectEntries(scope, layout, validTargets, providerSnapshots)
    return { revision: this.revision(scope, layout, validTargets, providerSnapshots, entries), entries }
  }

  private async projectEntriesForAdmission(
    input: WorkspacePaneLayoutSnapshotInput,
  ): Promise<WorkspacePaneTabsSnapshot['entries']> {
    const { scope, validTargets, providerSnapshots } = input
    const layout = (await this.repository.load(scope.repoRoot)).layout
    return this.projectEntries(scope, layout, validTargets, providerSnapshots)
  }

  private async validateRepairAndSnapshot(
    input: WorkspacePaneLayoutValidationInput,
  ): Promise<WorkspacePaneLayoutValidationResult> {
    const validKeys = new Set(input.validTargets.map(workspacePaneTabsTargetIdentityKey))
    input.assertCurrent?.()
    const outcome = await this.restoreTransaction.validateMembershipAndRepair({
        repoRoot: input.repoRoot,
        expectedRepoEntry: input.expectedRepoEntry,
        validTargetKeys: [...validKeys],
      })
    if (outcome.kind === 'membership-conflict') return { kind: 'membership-conflict' }
    input.assertCurrent?.()
    const overlayChanged = this.commitProjectionTargets({
      ...input,
      targets: input.validTargets,
      physicalTargets: input.physicalTargets,
    })
    const durableLayoutChanged = outcome.kind === 'accepted' && outcome.changed
    return {
      kind: 'validated',
      snapshot: await this.snapshot({
        scope: input,
        validTargets: input.validTargets,
        providerSnapshots: input.providerSnapshots,
        knownLayout: outcome.snapshot.layout,
      }),
      affectedUserIds: this.affectedUserIds(input, durableLayoutChanged, overlayChanged ? [input.userId] : []),
    }
  }

  private closeEpoch(scope: WorkspacePaneEpochScope): void {
    this.overlay.closeEpoch(scope)
    const key = epochKey(scope)
    this.clocks.delete(key)
  }

  private commitRuntimeTarget(input: WorkspacePaneEpochScope & {
    target: WorkspacePaneTabsTargetIdentity
    lease: PhysicalWorktreeAdmissionLease
    tabs: readonly WorkspacePaneTabEntry[]
  }): void {
    this.overlay.registerPhysicalTarget(input)
    this.overlay.recordMixedOrder(input)
  }

  physicalTargets(identity: PhysicalWorktreeIdentity) {
    return this.overlay.physicalTargets(identity)
  }

  activeEpochs(repoRoot: string): WorkspacePaneEpochScope[] {
    return this.overlay.activeEpochs(repoRoot)
  }

  epochsForUser(userId: string): WorkspacePaneEpochScope[] {
    return this.overlay.epochsForUser(userId)
  }

  runtimeSessionIds(input: WorkspacePaneEpochScope & {
    worktreePath: string
    type: WorkspacePaneRuntimeTabType
  }): string[] {
    return this.overlay.runtimeSessionIds(input)
  }

  private async mutate(
    input: WorkspacePaneLayoutReplaceInput | WorkspacePaneLayoutUpdateInput,
    applyIntent: (current: WorkspacePaneTabEntry[]) => WorkspacePaneTabEntry[],
    policy: { retryConflicts: boolean },
  ): Promise<WorkspacePaneLayoutCommitResult> {
    for (let conflicts = 0; ; conflicts += 1) {
      input.assertCurrent?.()
      const current = await this.repository.load(input.repoRoot)
      const target = resolveMutationTarget(input, input.validTargets)
      if (!target) throw new Error('error.workspace-tabs-target-invalid')
      const currentTabs = canonicalTabsForTarget({ ...input, ...target }, current.layout, this.overlay, input.providerSnapshots)
      const mixedTabs = applyIntent(currentTabs)
      const staticTabs = mixedTabs.filter((tab): tab is WorkspacePaneStaticTabEntry => !isWorkspacePaneRuntimeTabEntry(tab))
      const targetKey = workspacePaneTabsTargetIdentityKey(target)
      const entry = { ...target, tabs: staticTabs }
      const replacement = normalizeWorkspacePaneDurableLayout(input.repoRoot, {
        entries: [
          ...current.layout.entries.filter((candidate) => workspacePaneTabsTargetIdentityKey(candidate) !== targetKey),
          entry,
        ],
      })
      input.assertCurrent?.()
      const outcome = await this.repository.compareAndSwap({
        repoRoot: input.repoRoot,
        expected: current.layout,
        replacement,
      })
      if (outcome.kind === 'write-failure') throw outcome.error
      if (outcome.kind === 'conflict' && policy.retryConflicts && conflicts < MAX_LAYOUT_CAS_RETRIES) continue
      if (outcome.kind !== 'accepted') throw new Error('error.workspace-tabs-layout-conflict')
      const targetIdentityValue = targetIdentity(target)
      const placementChanged = this.overlay.recordMixedOrder({ ...input, target: targetIdentityValue, tabs: mixedTabs })
      if (input.physicalWorktreeLease) {
        this.overlay.registerPhysicalTarget({ ...input, target: targetIdentityValue, lease: input.physicalWorktreeLease })
      }
      return this.commitResult(
        input,
        outcome.changed,
        placementChanged ? [input.userId] : [],
      )
    }
  }

  private revision(
    scope: WorkspacePaneEpochScope,
    layout: WorkspacePaneDurableLayout,
    validTargets: readonly WorkspacePaneTabsTarget[],
    providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
    entries: WorkspacePaneTabsSnapshot['entries'],
  ): number {
    const key = epochKey(scope)
    const layoutToken = JSON.stringify(normalizeWorkspacePaneDurableLayout(scope.repoRoot, layout))
    const providerRevisions = new Map(providerRevisionMap(providers))
    const overlayRevision = this.overlay.revision(scope)
    const targetProjectionToken = JSON.stringify([...targetMap(validTargets)])
    const entriesToken = JSON.stringify(entries)
    const current = this.clocks.get(key)
    if (!current) {
      this.clocks.set(key, {
        layoutToken,
        overlayRevision,
        targetProjectionToken,
        providerRevisions,
        entriesToken,
        revision: 0,
      })
      return 0
    }
    for (const [type, revision] of providerRevisions) {
      if (revision < (current.providerRevisions.get(type) ?? 0)) {
        throw new Error('error.workspace-tabs-provider-snapshot-stale')
      }
    }
    const dependenciesChanged = current.layoutToken !== layoutToken ||
      current.overlayRevision !== overlayRevision ||
      current.targetProjectionToken !== targetProjectionToken ||
      !mapsEqual(current.providerRevisions, providerRevisions)
    if (!dependenciesChanged) {
      if (current.entriesToken !== entriesToken) throw new Error('error.workspace-tabs-provider-snapshot-inconsistent')
      return current.revision
    }
    const next = {
      layoutToken,
      overlayRevision,
      targetProjectionToken,
      providerRevisions,
      entriesToken,
      revision: current.revision + 1,
    }
    this.clocks.set(key, next)
    return next.revision
  }

  private commitProjectionTargets(input: WorkspacePaneEpochScope & {
    targets: readonly WorkspacePaneTabsTarget[]
    physicalTargets: readonly { target: WorkspacePaneTabsTargetIdentity; lease: PhysicalWorktreeAdmissionLease }[]
  }): boolean {
    const next = targetMap(input.targets)
    const overlayChanged = this.overlay.retainTargets(input, new Set(next.keys()))
    for (const physical of input.physicalTargets) {
      this.overlay.registerPhysicalTarget({ ...input, ...physical })
    }
    return overlayChanged
  }

  private projectEntries(
    scope: WorkspacePaneEpochScope,
    layout: WorkspacePaneDurableLayout,
    validTargets: readonly WorkspacePaneTabsTarget[],
    providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
  ): WorkspacePaneTabsSnapshot['entries'] {
    return projectCanonicalEntries(
      scope,
      layout,
      this.overlay,
      targetMap(validTargets),
      providers,
    )
  }

  private commitResult(
    scope: WorkspacePaneEpochScope,
    durableLayoutChanged: boolean,
    localAffectedUserIds: readonly string[] = [],
  ): WorkspacePaneLayoutCommitResult {
    return {
      affectedUserIds: this.affectedUserIds(scope, durableLayoutChanged, localAffectedUserIds),
    }
  }

  private affectedUserIds(
    scope: WorkspacePaneEpochScope,
    durableLayoutChanged: boolean,
    localAffectedUserIds: readonly string[] = [],
  ): string[] {
    const affected = new Set(localAffectedUserIds)
    if (durableLayoutChanged) {
      affected.add(scope.userId)
      for (const active of this.overlay.activeEpochs(scope.repoRoot)) affected.add(active.userId)
    }
    return [...affected]
  }
}

function projectCanonicalEntries(
  scope: WorkspacePaneEpochScope,
  layout: WorkspacePaneDurableLayout,
  overlay: WorkspacePaneEpochOverlay,
  validatedTargets: ReadonlyMap<string, WorkspacePaneTabsTarget>,
  providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
): WorkspacePaneTabsSnapshot['entries'] {
  const liveTargets = providerTargets(scope, providers)
  layout = {
    entries: layout.entries.filter((entry) =>
      validatedTargets.has(workspacePaneTabsTargetIdentityKey(entry)),
    ),
  }
  const targets = new Map<string, WorkspacePaneTabsTarget>()
  for (const entry of layout.entries) {
    const key = workspacePaneTabsTargetIdentityKey(entry)
    targets.set(key, validatedTargets.get(key) ?? entry)
  }
  for (const [key, target] of liveTargets) targets.set(key, target)
  return Array.from(targets.values()).map((target) => {
    const tabs = canonicalTabsForTarget({ ...scope, ...target }, layout, overlay, providers)
    return { repoRoot: scope.repoRoot, branchName: target.branchName, worktreePath: target.worktreePath, tabs }
  })
}

function providerTargets(
  scope: Pick<WorkspacePaneEpochScope, 'repoRoot'>,
  providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
): Map<string, WorkspacePaneTabsTarget> {
  const targets = new Map<string, WorkspacePaneTabsTarget>()
  for (const provider of providers) {
    for (const session of provider.liveSessions) {
      const target = { repoRoot: scope.repoRoot, branchName: session.branch, worktreePath: session.worktreePath }
      targets.set(workspacePaneTabsTargetIdentityKey(target), target)
    }
  }
  return targets
}

function targetMap(targets: readonly WorkspacePaneTabsTarget[]): Map<string, WorkspacePaneTabsTarget> {
  return new Map(targets
    .map((target) => [workspacePaneTabsTargetIdentityKey(target), { ...target }] as const)
    .sort(([a], [b]) => a.localeCompare(b)))
}

function resolveMutationTarget(
  scope: WorkspacePaneEpochScope & WorkspacePaneTabsTarget,
  validTargets: readonly WorkspacePaneTabsTarget[],
): WorkspacePaneTabsTarget | null {
  const targetKey = workspacePaneTabsTargetIdentityKey(scope)
  return targetMap(validTargets).get(targetKey) ?? null
}

function canonicalTabsForTarget(
  input: WorkspacePaneEpochScope & WorkspacePaneTabsTarget,
  layout: WorkspacePaneDurableLayout,
  overlay: WorkspacePaneEpochOverlay,
  providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
): WorkspacePaneTabEntry[] {
  const key = workspacePaneTabsTargetIdentityKey(input)
  const durable = layout.entries.find((entry) => workspacePaneTabsTargetIdentityKey(entry) === key)
  const staticTabs = durable?.tabs ?? [workspacePaneStaticTabEntry('status')]
  const liveRuntimeTabs = providers.flatMap((provider) => provider.liveSessions
    .filter((session) => input.worktreePath !== null && session.worktreePath === input.worktreePath)
    .map((session) => workspacePaneRuntimeTabEntry(provider.type, session.sessionId)))
  return projectRuntimePlacements({
    staticTabs,
    hints: overlay.placementHints({ ...input, target: targetIdentity(input) }),
    liveRuntimeTabs,
  })
}

function targetIdentity(target: WorkspacePaneTabsTarget): WorkspacePaneTabsTargetIdentity {
  return target.worktreePath === null
    ? { kind: 'branch', repoRoot: target.repoRoot, branchName: target.branchName }
    : { kind: 'worktree', repoRoot: target.repoRoot, worktreePath: target.worktreePath }
}

function epochKey(scope: WorkspacePaneEpochScope): string {
  return `${scope.userId}\0${scope.repoRoot}\0${scope.repoRuntimeId}`
}

function mapsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  return a.size === b.size && Array.from(a).every(([key, value]) => b.get(key) === value)
}
