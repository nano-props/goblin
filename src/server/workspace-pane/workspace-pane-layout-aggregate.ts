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

const MAX_LAYOUT_CAS_RETRIES = 3

interface CanonicalClockState {
  layoutToken: string
  overlayRevision: number
  providerRevisions: Map<string, number>
  entriesToken: string
  revision: number
}

export type WorkspacePaneLayoutValidationResult =
  | { kind: 'validated'; snapshot: WorkspacePaneTabsSnapshot; durableLayoutChanged: boolean }
  | { kind: 'membership-conflict' }

export class WorkspacePaneLayoutAggregate {
  private readonly repository: WorkspacePaneLayoutRepository
  readonly overlay: WorkspacePaneEpochOverlay
  private readonly clocks = new Map<string, CanonicalClockState>()

  constructor(options: { repository: WorkspacePaneLayoutRepository; overlay?: WorkspacePaneEpochOverlay }) {
    this.repository = options.repository
    this.overlay = options.overlay ?? new WorkspacePaneEpochOverlay()
  }

  async replace(input: WorkspacePaneEpochScope & WorkspacePaneTabsTarget & {
    tabs: readonly WorkspacePaneTabEntry[]
    providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
    assertCurrent?: () => void
  }): Promise<WorkspacePaneTabsSnapshot> {
    return await this.mutate(input, () => [...input.tabs], { retryConflicts: false })
  }

  async update(input: WorkspacePaneEpochScope & WorkspacePaneTabsTarget & {
    operation: WorkspacePaneTabsUpdateOperation
    providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
    assertCurrent?: () => void
  }): Promise<WorkspacePaneTabsSnapshot> {
    return await this.mutate(input, (current) => workspacePaneTabsWithUpdateOperation(current, input.operation), {
      retryConflicts: true,
    })
  }

  async retire(input: WorkspacePaneEpochScope & {
    target: WorkspacePaneTabsTargetIdentity
    providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
    assertCurrent?: () => void
  }): Promise<WorkspacePaneTabsSnapshot> {
    for (let conflicts = 0; ; conflicts += 1) {
      input.assertCurrent?.()
      const current = await this.repository.load(input.repoRoot)
      input.assertCurrent?.()
      const targetKey = workspacePaneTabsTargetIdentityKeyFromIdentity(input.target)
      const replacement = {
        entries: current.layout.entries.filter((entry) => workspacePaneTabsTargetIdentityKey(entry) !== targetKey),
      }
      const outcome = await this.repository.compareAndSwap({
        repoRoot: input.repoRoot,
        expected: current.layout,
        replacement,
      })
      if (outcome.kind === 'failure') throw outcome.error
      if (outcome.kind === 'conflict' && conflicts < MAX_LAYOUT_CAS_RETRIES) continue
      if (outcome.kind !== 'accepted') throw new Error('error.workspace-tabs-layout-conflict')
      this.overlay.retireTarget(input.target)
      return await this.snapshot(input, input.providerSnapshots, outcome.snapshot.layout)
    }
  }

  async snapshot(
    scope: WorkspacePaneEpochScope,
    providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
    knownLayout?: WorkspacePaneDurableLayout,
  ): Promise<WorkspacePaneTabsSnapshot> {
    this.overlay.activate(scope)
    const layout = knownLayout ?? (await this.repository.load(scope.repoRoot)).layout
    const entries = projectCanonicalEntries(scope, layout, this.overlay, providerSnapshots)
    return { revision: this.revision(scope, layout, providerSnapshots, entries), entries }
  }

  async validateRepairAndSnapshot(input: WorkspacePaneEpochScope & {
    validTargets: readonly WorkspacePaneTabsTarget[]
    expectedRepoEntry: RepoSessionEntry
    providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
    assertCurrent?: () => void
  }): Promise<WorkspacePaneLayoutValidationResult> {
    const validKeys = new Set(input.validTargets.map(workspacePaneTabsTargetIdentityKey))
    for (let conflicts = 0; ; conflicts += 1) {
      input.assertCurrent?.()
      const current = await this.repository.load(input.repoRoot)
      const filtered = {
        entries: current.layout.entries.filter((entry) => validKeys.has(workspacePaneTabsTargetIdentityKey(entry))),
      }
      const outcome = await this.repository.compareAndSwap({
        repoRoot: input.repoRoot,
        expected: current.layout,
        replacement: filtered,
        expectedRepoEntry: input.expectedRepoEntry,
      })
      if (outcome.kind === 'failure') {
        this.commitValidatedTargetCatalog(input)
        return {
          kind: 'validated',
          snapshot: await this.snapshot(input, input.providerSnapshots, current.layout),
          durableLayoutChanged: false,
        }
      }
      if (outcome.kind === 'conflict' && conflicts < MAX_LAYOUT_CAS_RETRIES) continue
      if (outcome.kind === 'membership-conflict') return { kind: 'membership-conflict' }
      if (outcome.kind !== 'accepted') {
        this.commitValidatedTargetCatalog(input)
        return {
          kind: 'validated',
          snapshot: await this.snapshot(input, input.providerSnapshots, current.layout),
          durableLayoutChanged: false,
        }
      }
      this.commitValidatedTargetCatalog(input)
      return {
        kind: 'validated',
        snapshot: await this.snapshot(input, input.providerSnapshots, outcome.snapshot.layout),
        durableLayoutChanged: outcome.changed,
      }
    }
  }

  closeEpoch(scope: WorkspacePaneEpochScope): void {
    this.overlay.closeEpoch(scope)
    this.clocks.delete(epochKey(scope))
  }

  private async mutate(
    input: WorkspacePaneEpochScope & WorkspacePaneTabsTarget & {
      providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
      assertCurrent?: () => void
    },
    applyIntent: (current: WorkspacePaneTabEntry[]) => WorkspacePaneTabEntry[],
    policy: { retryConflicts: boolean },
  ): Promise<WorkspacePaneTabsSnapshot> {
    for (let conflicts = 0; ; conflicts += 1) {
      input.assertCurrent?.()
      const current = await this.repository.load(input.repoRoot)
      const currentTabs = canonicalTabsForTarget(input, current.layout, this.overlay, input.providerSnapshots)
      const mixedTabs = applyIntent(currentTabs)
      const staticTabs = mixedTabs.filter((tab): tab is WorkspacePaneStaticTabEntry => !isWorkspacePaneRuntimeTabEntry(tab))
      const targetKey = workspacePaneTabsTargetIdentityKey(input)
      const entry = { ...input, tabs: staticTabs }
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
      if (outcome.kind === 'failure') throw outcome.error
      if (outcome.kind === 'conflict' && policy.retryConflicts && conflicts < MAX_LAYOUT_CAS_RETRIES) continue
      if (outcome.kind !== 'accepted') throw new Error('error.workspace-tabs-layout-conflict')
      const target = targetIdentity(input)
      this.overlay.admitValidatedTarget({ ...input, target, branchName: input.branchName })
      this.overlay.recordMixedOrder({ ...input, target, tabs: mixedTabs })
      return await this.snapshot(input, input.providerSnapshots, outcome.snapshot.layout)
    }
  }

  private revision(
    scope: WorkspacePaneEpochScope,
    layout: WorkspacePaneDurableLayout,
    providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
    entries: WorkspacePaneTabsSnapshot['entries'],
  ): number {
    const key = epochKey(scope)
    const layoutToken = JSON.stringify(normalizeWorkspacePaneDurableLayout(scope.repoRoot, layout))
    const providerRevisions = new Map(providerRevisionMap(providers))
    const overlayRevision = this.overlay.revision(scope)
    const entriesToken = JSON.stringify(entries)
    const current = this.clocks.get(key)
    if (!current) {
      this.clocks.set(key, { layoutToken, overlayRevision, providerRevisions, entriesToken, revision: 0 })
      return 0
    }
    for (const [type, revision] of providerRevisions) {
      if (revision < (current.providerRevisions.get(type) ?? 0)) {
        throw new Error('error.workspace-tabs-provider-snapshot-stale')
      }
    }
    const dependenciesChanged = current.layoutToken !== layoutToken ||
      current.overlayRevision !== overlayRevision ||
      !mapsEqual(current.providerRevisions, providerRevisions)
    if (!dependenciesChanged) {
      if (current.entriesToken !== entriesToken) throw new Error('error.workspace-tabs-provider-snapshot-inconsistent')
      return current.revision
    }
    const next = { layoutToken, overlayRevision, providerRevisions, entriesToken, revision: current.revision + 1 }
    this.clocks.set(key, next)
    return next.revision
  }

  private commitValidatedTargetCatalog(input: WorkspacePaneEpochScope & {
    validTargets: readonly WorkspacePaneTabsTarget[]
  }): void {
    this.overlay.commitValidatedTargets(input, input.validTargets.map((target) => ({
      target: targetIdentity(target),
      branchName: target.branchName,
    })))
  }
}

function projectCanonicalEntries(
  scope: WorkspacePaneEpochScope,
  layout: WorkspacePaneDurableLayout,
  overlay: WorkspacePaneEpochOverlay,
  providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
): WorkspacePaneTabsSnapshot['entries'] {
  layout = {
    entries: layout.entries.filter((entry) =>
      overlay.isDurableTargetVisible(scope, workspacePaneTabsTargetIdentityKey(entry)),
    ),
  }
  const targets = new Map<string, WorkspacePaneTabsTarget>()
  for (const entry of layout.entries) targets.set(workspacePaneTabsTargetIdentityKey(entry), entry)
  for (const provider of providers) {
    for (const session of provider.liveSessions) {
      const target = { repoRoot: scope.repoRoot, branchName: session.branch, worktreePath: session.worktreePath }
      targets.set(workspacePaneTabsTargetIdentityKey(target), target)
    }
  }
  return Array.from(targets.values()).map((target) => {
    const tabs = canonicalTabsForTarget({ ...scope, ...target }, layout, overlay, providers)
    const identity = targetIdentity(target)
    const branchName = target.worktreePath === null
      ? target.branchName
      : overlay.targetBranchName({ ...scope, target: identity }) ?? target.branchName
    return { repoRoot: scope.repoRoot, branchName, worktreePath: target.worktreePath, tabs }
  })
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
