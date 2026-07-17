import PQueue from 'p-queue'
import {
  isWorkspacePaneRuntimeTabEntry,
  workspacePaneRuntimeTabEntry,
  workspacePaneStaticTabEntry,
  type WorkspacePaneStaticTabEntry,
  type WorkspacePaneTabEntry,
} from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneDurableLayout,
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateOperation,
} from '#/shared/workspace-pane-tabs.ts'
import {
  restorableWorkspacePaneTargetKey,
  workspacePaneTabsTargetFromRestorable,
  runtimeWorkspacePaneTargetKey,
  restorableWorkspacePaneTargetFromRuntime,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { RestorableWorkspacePaneTarget, RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
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
import type { WorkspaceSessionEntry } from '#/shared/remote-repo.ts'
import type { PhysicalWorktreeIdentity } from '#/server/worktree-removal/physical-worktree-identity.ts'
import type { PhysicalWorktreeAdmissionLease } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import type { WorkspacePaneLayoutRestoreTransaction } from '#/server/workspace-pane/workspace-pane-layout-restore-transaction.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

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
  | { target: RuntimeWorkspacePaneTarget; nativeWorktreePath: null; physicalWorktreeLease?: never }
  | {
      target: RuntimeWorkspacePaneTarget
      nativeWorktreePath: string
      physicalWorktreeLease: PhysicalWorktreeAdmissionLease
    }

export interface WorkspacePaneTargetProjection {
  target: RuntimeWorkspacePaneTarget
  nativeWorktreePath: string | null
  canonicalBranch: string | null
}

export type WorkspacePaneLayoutReplaceInput = WorkspacePaneEpochScope &
  WorkspacePaneLayoutMutationTarget & {
    tabs: readonly WorkspacePaneTabEntry[]
    validTargets: readonly WorkspacePaneTargetProjection[]
    providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
    assertCurrent?: () => void
  }

export type WorkspacePaneLayoutUpdateInput = WorkspacePaneEpochScope &
  WorkspacePaneLayoutMutationTarget & {
    operation: WorkspacePaneTabsUpdateOperation
    validTargets: readonly WorkspacePaneTargetProjection[]
    providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
    assertCurrent?: () => void
  }

export interface WorkspacePaneLayoutSnapshotInput {
  scope: WorkspacePaneEpochScope
  validTargets: readonly WorkspacePaneTargetProjection[]
  providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
  knownLayout?: WorkspacePaneDurableLayout
}

export type WorkspacePaneLayoutValidationInput = WorkspacePaneEpochScope & {
  validTargets: readonly WorkspacePaneTargetProjection[]
  physicalTargets: readonly { target: RuntimeWorkspacePaneTarget; lease: PhysicalWorktreeAdmissionLease }[]
  expectedRepoEntry: WorkspaceSessionEntry
  providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
  assertCurrent?: () => void
}

export interface WorkspacePaneLayoutOperation {
  replace(input: WorkspacePaneLayoutReplaceInput): Promise<WorkspacePaneLayoutCommitResult>
  update(input: WorkspacePaneLayoutUpdateInput): Promise<WorkspacePaneLayoutCommitResult>
  snapshot(input: WorkspacePaneLayoutSnapshotInput): Promise<WorkspacePaneTabsSnapshot>
  projectEntriesForAdmission(input: WorkspacePaneLayoutSnapshotInput): Promise<WorkspacePaneTabsSnapshot['entries']>
  validateMembershipAndSnapshot(input: WorkspacePaneLayoutValidationInput): Promise<WorkspacePaneLayoutValidationResult>
  commitRuntimeTarget(
    input: WorkspacePaneEpochScope & {
      target: RuntimeWorkspacePaneTarget
      lease: PhysicalWorktreeAdmissionLease
      tabs: readonly WorkspacePaneTabEntry[]
    },
  ): void
  closeEpoch(scope: WorkspacePaneEpochScope): void
  commitProjectionTargets(
    input: WorkspacePaneEpochScope & {
      targets: readonly WorkspacePaneTargetProjection[]
      physicalTargets: readonly { target: RuntimeWorkspacePaneTarget; lease: PhysicalWorktreeAdmissionLease }[]
    },
  ): void
  indexedAdmissionLeases(scope: WorkspacePaneEpochScope): PhysicalWorktreeAdmissionLease[]
  clearPhysicalIdentity(repoRoot: string, lease: PhysicalWorktreeAdmissionLease): WorkspacePaneEpochScope[]
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
      return await queue.add(() =>
        task({
          replace: async (input) => await this.replace(input),
          update: async (input) => await this.update(input),
          snapshot: async (input) => await this.snapshot(input),
          projectEntriesForAdmission: async (input) => await this.projectEntriesForAdmission(input),
          validateMembershipAndSnapshot: async (input) => await this.validateMembershipAndSnapshot(input),
          commitRuntimeTarget: (input) => this.commitRuntimeTarget(input),
          closeEpoch: (scope) => this.closeEpoch(scope),
          commitProjectionTargets: (input) => this.commitProjectionTargets(input),
          indexedAdmissionLeases: (scope) => this.overlay.indexedAdmissionLeases(scope),
          clearPhysicalIdentity: (scopedRepoRoot, identity) =>
            this.overlay.clearPhysicalIdentity(scopedRepoRoot, identity),
        }),
      )
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

  private async snapshot(input: WorkspacePaneLayoutSnapshotInput): Promise<WorkspacePaneTabsSnapshot> {
    const { scope, validTargets, providerSnapshots, knownLayout } = input
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

  private async validateMembershipAndSnapshot(
    input: WorkspacePaneLayoutValidationInput,
  ): Promise<WorkspacePaneLayoutValidationResult> {
    input.assertCurrent?.()
    const outcome = await this.restoreTransaction.validateMembershipAndLoad({
      repoRoot: input.repoRoot,
      expectedRepoEntry: input.expectedRepoEntry,
    })
    if (outcome.kind === 'membership-conflict') return { kind: 'membership-conflict' }
    input.assertCurrent?.()
    const overlayChanged = this.commitProjectionTargets({
      ...input,
      targets: input.validTargets,
      physicalTargets: input.physicalTargets,
    })
    return {
      kind: 'validated',
      snapshot: await this.snapshot({
        scope: input,
        validTargets: input.validTargets,
        providerSnapshots: input.providerSnapshots,
        knownLayout: outcome.snapshot.layout,
      }),
      affectedUserIds: this.affectedUserIds(input, false, overlayChanged ? [input.userId] : []),
    }
  }

  private closeEpoch(scope: WorkspacePaneEpochScope): void {
    this.overlay.closeEpoch(scope)
    const key = epochKey(scope)
    this.clocks.delete(key)
  }

  private commitRuntimeTarget(
    input: WorkspacePaneEpochScope & {
      target: RuntimeWorkspacePaneTarget
      lease: PhysicalWorktreeAdmissionLease
      tabs: readonly WorkspacePaneTabEntry[]
    },
  ): void {
    this.overlay.registerPhysicalTarget(input)
    this.overlay.recordMixedOrder(input)
  }

  physicalTargets(target: PhysicalWorktreeAdmissionLease | PhysicalWorktreeIdentity) {
    return this.overlay.physicalTargets(target)
  }

  activeEpochs(repoRoot: string): WorkspacePaneEpochScope[] {
    return this.overlay.activeEpochs(repoRoot)
  }

  epochsForUser(userId: string): WorkspacePaneEpochScope[] {
    return this.overlay.epochsForUser(userId)
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
      const currentTabs = canonicalTabsForTarget(
        { ...input, ...target },
        current.layout,
        this.overlay,
        input.providerSnapshots,
      )
      const mixedTabs = applyIntent(currentTabs)
      const staticTabs = mixedTabs.filter(
        (tab): tab is WorkspacePaneStaticTabEntry => !isWorkspacePaneRuntimeTabEntry(tab),
      )
      const targetKey = targetProjectionKey(target)
      const durableTarget = restorableWorkspacePaneTargetFromRuntime(target.target)
      if (!durableTarget) throw new Error('error.workspace-tabs-target-invalid')
      const entry = { target: durableTarget, tabs: staticTabs }
      const replacement = normalizeWorkspacePaneDurableLayout(input.repoRoot, {
        entries: [
          ...current.layout.entries.filter(
            (candidate) =>
              restorableWorkspacePaneTargetKey(candidate.target) !== restorableWorkspacePaneTargetKey(durableTarget),
          ),
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
      const placementChanged = this.overlay.recordMixedOrder({ ...input, target: target.target, tabs: mixedTabs })
      if (input.physicalWorktreeLease) {
        this.overlay.registerPhysicalTarget({
          ...input,
          target: target.target,
          lease: input.physicalWorktreeLease,
        })
      }
      return this.commitResult(input, outcome.changed, placementChanged ? [input.userId] : [])
    }
  }

  private revision(
    scope: WorkspacePaneEpochScope,
    layout: WorkspacePaneDurableLayout,
    validTargets: readonly WorkspacePaneTargetProjection[],
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
    const dependenciesChanged =
      current.layoutToken !== layoutToken ||
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

  private commitProjectionTargets(
    input: WorkspacePaneEpochScope & {
      targets: readonly WorkspacePaneTargetProjection[]
      physicalTargets: readonly { target: RuntimeWorkspacePaneTarget; lease: PhysicalWorktreeAdmissionLease }[]
    },
  ): boolean {
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
    validTargets: readonly WorkspacePaneTargetProjection[],
    providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
  ): WorkspacePaneTabsSnapshot['entries'] {
    return projectCanonicalEntries(scope, layout, this.overlay, targetMap(validTargets), providers)
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
  validatedTargets: ReadonlyMap<string, WorkspacePaneTargetProjection>,
  providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
): WorkspacePaneTabsSnapshot['entries'] {
  const liveTargets = providerTargets(scope, validatedTargets, providers)
  layout = {
    entries: layout.entries.filter((entry) => validatedTargets.has(durableTargetKey(scope, entry.target))),
  }
  const targets = new Map<string, WorkspacePaneTargetProjection>()
  for (const entry of layout.entries) {
    const key = durableTargetKey(scope, entry.target)
    const projection = validatedTargets.get(key)
    if (!projection) throw new Error('error.workspace-tabs-target-invalid')
    targets.set(key, projection)
  }
  for (const [key, target] of liveTargets) targets.set(key, target)
  return Array.from(targets.values()).map((projection) => {
    const tabs = canonicalTabsForTarget({ ...scope, ...projection }, layout, overlay, providers)
    return { target: projection.target, tabs }
  })
}

function providerTargets(
  scope: WorkspacePaneEpochScope,
  validatedTargets: ReadonlyMap<string, WorkspacePaneTargetProjection>,
  providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
): Map<string, WorkspacePaneTargetProjection> {
  const targets = new Map<string, WorkspacePaneTargetProjection>()
  for (const provider of providers) {
    for (const session of provider.liveSessions) {
      if (session.target.workspaceId !== scope.repoRoot || session.target.workspaceRuntimeId !== scope.repoRuntimeId) {
        throw new Error('error.workspace-tabs-target-invalid')
      }
      const key = runtimeTargetKey(session.target)
      const validated = validatedTargets.get(key)
      if (validated && validated.nativeWorktreePath !== session.worktreePath) {
        throw new Error('error.workspace-tabs-target-invalid')
      }
      targets.set(
        key,
        validated ?? {
          target: session.target,
          nativeWorktreePath: session.worktreePath,
          canonicalBranch: session.branch,
        },
      )
    }
  }
  return targets
}

function targetMap(targets: readonly WorkspacePaneTargetProjection[]): Map<string, WorkspacePaneTargetProjection> {
  return new Map(
    targets
      .map(
        (projection) => [targetProjectionKey(projection), { ...projection, target: { ...projection.target } }] as const,
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}

function resolveMutationTarget(
  scope: WorkspacePaneEpochScope & WorkspacePaneLayoutMutationTarget,
  validTargets: readonly WorkspacePaneTargetProjection[],
): WorkspacePaneTargetProjection | null {
  const projection = targetMap(validTargets).get(runtimeTargetKey(scope.target)) ?? null
  return projection && projection.nativeWorktreePath === scope.nativeWorktreePath ? projection : null
}

function canonicalTabsForTarget(
  input: WorkspacePaneEpochScope & WorkspacePaneTargetProjection,
  layout: WorkspacePaneDurableLayout,
  overlay: WorkspacePaneEpochOverlay,
  providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
): WorkspacePaneTabEntry[] {
  const durable = layout.entries.find((entry) => durableTargetKey(input, entry.target) === targetProjectionKey(input))
  const staticTabs = durable?.tabs ?? [
    workspacePaneStaticTabEntry(input.target.kind === 'workspace' ? 'files' : 'status'),
  ]
  const liveRuntimeTabs = providers.flatMap((provider) =>
    provider.liveSessions
      .filter((session) => input.nativeWorktreePath !== null && session.worktreePath === input.nativeWorktreePath)
      .map((session) => workspacePaneRuntimeTabEntry(provider.type, session.sessionId)),
  )
  return projectRuntimePlacements({
    staticTabs,
    hints: overlay.placementHints(input),
    liveRuntimeTabs,
  })
}

function durableTargetKey(
  scope: Pick<WorkspacePaneEpochScope, 'repoRoot' | 'repoRuntimeId'>,
  target: RestorableWorkspacePaneTarget,
): string {
  const runtime = workspacePaneTabsTargetFromRestorable(scope.repoRoot, target)
  if (!runtime) throw new Error('error.workspace-tabs-target-invalid')
  const workspaceId = canonicalWorkspaceLocator(scope.repoRoot)
  if (!workspaceId) throw new Error('error.workspace-tabs-target-invalid')
  const bound =
    target.kind === 'workspace'
      ? { kind: 'workspace' as const, workspaceId, workspaceRuntimeId: scope.repoRuntimeId }
      : target.kind === 'git-branch'
        ? { ...target, workspaceId, workspaceRuntimeId: scope.repoRuntimeId }
        : { ...target, workspaceId, workspaceRuntimeId: scope.repoRuntimeId }
  return runtimeTargetKey(bound)
}

function runtimeTargetKey(target: RuntimeWorkspacePaneTarget): string {
  const key = runtimeWorkspacePaneTargetKey(target)
  if (!key) throw new Error('error.workspace-tabs-target-invalid')
  return key
}

function targetProjectionKey(projection: WorkspacePaneTargetProjection): string {
  return runtimeTargetKey(projection.target)
}

function epochKey(scope: WorkspacePaneEpochScope): string {
  return `${scope.userId}\0${scope.repoRoot}\0${scope.repoRuntimeId}`
}

function mapsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  return a.size === b.size && Array.from(a).every(([key, value]) => b.get(key) === value)
}
