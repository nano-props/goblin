import {
  isWorkspacePaneRuntimeTabEntry,
  workspacePaneTabEntryIdentity,
  type WorkspacePaneRuntimeTabType,
  type WorkspacePaneTabEntry,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsTargetIdentity } from '#/shared/workspace-pane-tabs-target.ts'
import {
  workspacePaneTabsTargetIdentityKeyFromIdentity,
} from '#/shared/workspace-pane-tabs-target.ts'
import {
  physicalWorktreeIdentityKey,
  type PhysicalWorktreeIdentity,
} from '#/server/worktree-removal/physical-worktree-identity.ts'

export interface WorkspacePaneEpochScope {
  userId: string
  repoRoot: string
  repoRuntimeId: string
}

export interface WorkspacePaneRuntimePlacementHint {
  identity: string
  afterStaticCandidates: string[]
}

export interface WorkspacePaneEpochTargetRef extends WorkspacePaneEpochScope {
  target: WorkspacePaneTabsTargetIdentity
}

interface EpochState {
  overlayRevision: number
  placementsByTarget: Map<string, WorkspacePaneRuntimePlacementHint[]>
  physicalKeysByTarget: Map<string, string>
}

export class WorkspacePaneEpochOverlay {
  private readonly epochs = new Map<string, EpochState>()
  private readonly targetsByPhysicalKey = new Map<string, Map<string, WorkspacePaneEpochTargetRef>>()
  private readonly epochsByRepoRoot = new Map<string, Map<string, WorkspacePaneEpochScope>>()

  activate(scope: WorkspacePaneEpochScope): void {
    this.state(scope)
  }

  recordMixedOrder(input: WorkspacePaneEpochTargetRef & { tabs: readonly WorkspacePaneTabEntry[] }): boolean {
    const state = this.state(input)
    const targetKey = workspacePaneTabsTargetIdentityKeyFromIdentity(input.target)
    const next = runtimePlacementHints(input.tabs)
    const current = state.placementsByTarget.get(targetKey) ?? []
    if (JSON.stringify(current) === JSON.stringify(next)) return false
    if (next.length === 0) state.placementsByTarget.delete(targetKey)
    else state.placementsByTarget.set(targetKey, next)
    state.overlayRevision += 1
    return true
  }

  placementHints(input: WorkspacePaneEpochTargetRef): WorkspacePaneRuntimePlacementHint[] {
    const state = this.epochs.get(epochKey(input))
    return state?.placementsByTarget.get(workspacePaneTabsTargetIdentityKeyFromIdentity(input.target))?.map(cloneHint) ?? []
  }

  registerPhysicalTarget(input: WorkspacePaneEpochTargetRef & { identity: PhysicalWorktreeIdentity }): void {
    const state = this.state(input)
    const targetKey = workspacePaneTabsTargetIdentityKeyFromIdentity(input.target)
    const physicalKey = physicalWorktreeIdentityKey(input.identity)
    const previous = state.physicalKeysByTarget.get(targetKey)
    if (previous === physicalKey) return
    if (previous) this.removePhysicalTarget(previous, input, targetKey)
    state.physicalKeysByTarget.set(targetKey, physicalKey)
    const refs = this.targetsByPhysicalKey.get(physicalKey) ?? new Map<string, WorkspacePaneEpochTargetRef>()
    refs.set(epochTargetKey(input, targetKey), cloneTargetRef(input))
    this.targetsByPhysicalKey.set(physicalKey, refs)
  }

  retainTargets(scope: WorkspacePaneEpochScope, targetKeys: ReadonlySet<string>): boolean {
    const state = this.state(scope)
    let derivedStateChanged = false
    const currentTargetKeys = new Set([
      ...state.placementsByTarget.keys(),
      ...state.physicalKeysByTarget.keys(),
    ])
    for (const key of currentTargetKeys) {
      if (targetKeys.has(key)) continue
      derivedStateChanged = this.removeTargetFromState(scope, state, key) || derivedStateChanged
    }
    if (derivedStateChanged) state.overlayRevision += 1
    return derivedStateChanged
  }

  physicalTargets(identity: PhysicalWorktreeIdentity): WorkspacePaneEpochTargetRef[] {
    return Array.from(this.targetsByPhysicalKey.get(physicalWorktreeIdentityKey(identity))?.values() ?? []).map(cloneTargetRef)
  }

  activeEpochs(repoRoot: string): WorkspacePaneEpochScope[] {
    return Array.from(this.epochsByRepoRoot.get(repoRoot)?.values() ?? []).map((scope) => ({ ...scope }))
  }

  isActive(scope: WorkspacePaneEpochScope): boolean {
    return this.epochs.has(epochKey(scope))
  }

  epochsForUser(userId: string): WorkspacePaneEpochScope[] {
    return Array.from(this.epochsByRepoRoot.values()).flatMap((epochs) =>
      Array.from(epochs.values()).filter((scope) => scope.userId === userId).map((scope) => ({ ...scope })),
    )
  }

  runtimeSessionIds(input: WorkspacePaneEpochScope & { worktreePath: string; type: WorkspacePaneRuntimeTabType }): string[] {
    const target = { kind: 'worktree' as const, repoRoot: input.repoRoot, worktreePath: input.worktreePath }
    const prefix = `${input.type}:`
    return this.placementHints({ ...input, target })
      .map((hint) => hint.identity)
      .filter((identity) => identity.startsWith(prefix))
      .map((identity) => identity.slice(prefix.length))
  }

  revision(scope: WorkspacePaneEpochScope): number {
    return this.epochs.get(epochKey(scope))?.overlayRevision ?? 0
  }

  closeEpoch(scope: WorkspacePaneEpochScope): void {
    const key = epochKey(scope)
    const state = this.epochs.get(key)
    if (!state) return
    for (const [targetKey, physicalKey] of state.physicalKeysByTarget) {
      this.removePhysicalTarget(physicalKey, scope, targetKey)
    }
    this.epochs.delete(key)
    const active = this.epochsByRepoRoot.get(scope.repoRoot)
    active?.delete(key)
    if (active?.size === 0) this.epochsByRepoRoot.delete(scope.repoRoot)
  }

  retireTarget(target: WorkspacePaneTabsTargetIdentity): WorkspacePaneEpochScope[] {
    const targetKey = workspacePaneTabsTargetIdentityKeyFromIdentity(target)
    const affected: WorkspacePaneEpochScope[] = []
    for (const [key, state] of this.epochs) {
      const placementChanged = state.placementsByTarget.delete(targetKey)
      const physicalKey = state.physicalKeysByTarget.get(targetKey)
      if (physicalKey) {
        const scope = scopeFromEpochKey(key)
        this.removePhysicalTarget(physicalKey, scope, targetKey)
        state.physicalKeysByTarget.delete(targetKey)
      }
      if (!placementChanged && !physicalKey) continue
      state.overlayRevision += 1
      affected.push(scopeFromEpochKey(key))
    }
    return affected
  }

  private state(scope: WorkspacePaneEpochScope): EpochState {
    const key = epochKey(scope)
    let state = this.epochs.get(key)
    if (!state) {
      state = {
        overlayRevision: 0,
        placementsByTarget: new Map(),
        physicalKeysByTarget: new Map(),
      }
      this.epochs.set(key, state)
      const active = this.epochsByRepoRoot.get(scope.repoRoot) ?? new Map<string, WorkspacePaneEpochScope>()
      active.set(key, { ...scope })
      this.epochsByRepoRoot.set(scope.repoRoot, active)
    }
    return state
  }

  private removePhysicalTarget(
    physicalKey: string,
    scope: WorkspacePaneEpochScope,
    targetKey: string,
  ): void {
    const refs = this.targetsByPhysicalKey.get(physicalKey)
    refs?.delete(epochTargetKey(scope, targetKey))
    if (refs?.size === 0) this.targetsByPhysicalKey.delete(physicalKey)
  }

  private removeTargetFromState(scope: WorkspacePaneEpochScope, state: EpochState, targetKey: string): boolean {
    const placementChanged = state.placementsByTarget.delete(targetKey)
    const physicalKey = state.physicalKeysByTarget.get(targetKey)
    if (physicalKey) {
      this.removePhysicalTarget(physicalKey, scope, targetKey)
      state.physicalKeysByTarget.delete(targetKey)
    }
    return placementChanged || physicalKey !== undefined
  }
}

export function runtimePlacementHints(tabs: readonly WorkspacePaneTabEntry[]): WorkspacePaneRuntimePlacementHint[] {
  const precedingStaticIdentities: string[] = []
  const hints: WorkspacePaneRuntimePlacementHint[] = []
  const seen = new Set<string>()
  for (const tab of tabs) {
    const identity = workspacePaneTabEntryIdentity(tab)
    if (seen.has(identity)) continue
    seen.add(identity)
    if (isWorkspacePaneRuntimeTabEntry(tab)) {
      hints.push({ identity, afterStaticCandidates: [...precedingStaticIdentities].reverse() })
    } else {
      precedingStaticIdentities.push(identity)
    }
  }
  return hints
}

export function projectRuntimePlacements(input: {
  staticTabs: readonly WorkspacePaneTabEntry[]
  hints: readonly WorkspacePaneRuntimePlacementHint[]
  liveRuntimeTabs: readonly WorkspacePaneTabEntry[]
}): WorkspacePaneTabEntry[] {
  const staticIdentities = new Set(input.staticTabs.map(workspacePaneTabEntryIdentity))
  const liveByIdentity = new Map(
    input.liveRuntimeTabs.filter(isWorkspacePaneRuntimeTabEntry).map((tab) => [workspacePaneTabEntryIdentity(tab), tab]),
  )
  const buckets = new Map<string | null, WorkspacePaneTabEntry[]>()
  for (const hint of input.hints) {
    const tab = liveByIdentity.get(hint.identity)
    if (!tab) continue
    liveByIdentity.delete(hint.identity)
    const anchor = hint.afterStaticCandidates.find((candidate) => staticIdentities.has(candidate)) ?? null
    buckets.set(anchor, [...(buckets.get(anchor) ?? []), tab])
  }
  const projected = [...(buckets.get(null) ?? [])]
  for (const tab of input.staticTabs) {
    projected.push(tab)
    projected.push(...(buckets.get(workspacePaneTabEntryIdentity(tab)) ?? []))
  }
  projected.push(...liveByIdentity.values())
  return projected
}

export function providerRevisionMap(
  providers: readonly { type: WorkspacePaneRuntimeTabType; revision: number }[],
): Map<WorkspacePaneRuntimeTabType, number> {
  const revisions = new Map<WorkspacePaneRuntimeTabType, number>()
  for (const provider of providers) {
    if (revisions.has(provider.type)) throw new Error('error.workspace-tabs-provider-type-duplicate')
    revisions.set(provider.type, provider.revision)
  }
  return revisions
}

export function runtimeIdentity(type: WorkspacePaneRuntimeTabType, sessionId: string): string {
  return `${type}:${sessionId}`
}

function epochKey(scope: WorkspacePaneEpochScope): string {
  return `${scope.userId}\0${scope.repoRoot}\0${scope.repoRuntimeId}`
}

function scopeFromEpochKey(key: string): WorkspacePaneEpochScope {
  const [userId, repoRoot, repoRuntimeId] = key.split('\0')
  if (!userId || !repoRoot || !repoRuntimeId) throw new Error('invalid workspace pane epoch key')
  return { userId, repoRoot, repoRuntimeId }
}

function epochTargetKey(scope: WorkspacePaneEpochScope, targetKey: string): string {
  return `${epochKey(scope)}\0${targetKey}`
}

function cloneHint(hint: WorkspacePaneRuntimePlacementHint): WorkspacePaneRuntimePlacementHint {
  return { identity: hint.identity, afterStaticCandidates: [...hint.afterStaticCandidates] }
}

function cloneTargetRef(ref: WorkspacePaneEpochTargetRef): WorkspacePaneEpochTargetRef {
  return { ...ref, target: { ...ref.target } }
}
