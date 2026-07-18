import { createOpaqueId, isOpaqueId } from '#/shared/opaque-id.ts'
import { serverLogger } from '#/server/logger.ts'
import type {
  RemoteRepoConnectionResult,
  RemoteRepoFailureReason,
  RemoteRepoRuntimeLifecycle,
  RemoteRepoTarget,
} from '#/shared/remote-repo.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import type {
  WorkspaceProbeState,
  WorkspaceRefreshResult,
  WorkspaceSettledProbeState,
} from '#/shared/workspace-runtime.ts'
import { canonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'

interface WorkspaceRuntimeState {
  workspaceId: WorkspaceId
  currentWorkspaceRuntimeId: string | null
  members: Map<string, number>
  nextMembershipGeneration: number
  remoteLifecycle: RemoteRepoRuntimeLifecycle
  remoteName: string | null
  remoteAttemptController: AbortController | null
  remoteAttemptPromise: Promise<RepoRemoteLifecycleRunResult> | null
  workspaceProbe: WorkspaceProbeState
  pendingWorkspaceProbeTransition: { before: WorkspaceProbeState; after: WorkspaceSettledProbeState } | null
  workspaceLifecycleTail: Promise<void>
  activeWorkspaceLifecycleOperations: number
}

export interface WorkspaceRuntimeClosedEvent {
  userId: string
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
}

export interface WorkspaceRuntimeMembershipAcquiredEvent {
  userId: string
  clientId: string
}

export interface WorkspaceRuntimeEntry {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  remoteLifecycle: RemoteRepoRuntimeLifecycle | null
  workspaceProbe: WorkspaceProbeState
}

export interface WorkspaceRuntimeMembershipLeaseEntry {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  generation: number
}

export interface WorkspaceRuntimeMembershipLease {
  userId: string
  clientId: string
  entries: WorkspaceRuntimeMembershipLeaseEntry[]
}

type TerminalRemoteLifecycle = Extract<RemoteRepoRuntimeLifecycle, { kind: 'ready' | 'failed' }>

export type RepoRemoteLifecycleRunResult =
  | { kind: 'settled'; name: string; lifecycle: TerminalRemoteLifecycle }
  | { kind: 'superseded' }
  | { kind: 'stale-runtime' }

export type RepoRemoteLifecycleFailResult =
  | { kind: 'settled'; name: string; lifecycle: Extract<RemoteRepoRuntimeLifecycle, { kind: 'failed' }> }
  | { kind: 'not-remote' }
  | { kind: 'stale-runtime' }

const workspaceRuntimesByUser = new Map<string, Map<string, WorkspaceRuntimeState>>()
const workspaceRuntimeClosedListeners = new Set<(event: WorkspaceRuntimeClosedEvent) => void>()
const workspaceRuntimeMembershipAcquiredListeners = new Set<(event: WorkspaceRuntimeMembershipAcquiredEvent) => void>()
const workspaceRuntimeLogger = serverLogger.child({ tag: 'workspace-runtime' })

function workspaceRuntimeStateByUser(userId: string): Map<string, WorkspaceRuntimeState> {
  let states = workspaceRuntimesByUser.get(userId)
  if (states) return states
  states = new Map<string, WorkspaceRuntimeState>()
  workspaceRuntimesByUser.set(userId, states)
  return states
}

function workspaceRuntimeState(userId: string, workspaceId: WorkspaceId): WorkspaceRuntimeState {
  const byWorkspace = workspaceRuntimeStateByUser(userId)
  const existing = byWorkspace.get(workspaceId)
  if (existing) return existing
  const created: WorkspaceRuntimeState = {
    workspaceId,
    currentWorkspaceRuntimeId: null,
    members: new Map(),
    nextMembershipGeneration: 0,
    remoteLifecycle: { kind: 'idle', attemptId: 0 },
    remoteName: null,
    remoteAttemptController: null,
    remoteAttemptPromise: null,
    workspaceProbe: { status: 'probing' },
    pendingWorkspaceProbeTransition: null,
    workspaceLifecycleTail: Promise.resolve(),
    activeWorkspaceLifecycleOperations: 0,
  }
  byWorkspace.set(workspaceId, created)
  return created
}

function requiredCanonicalWorkspaceId(workspaceId: string): WorkspaceId {
  const canonicalWorkspaceId = canonicalWorkspaceLocator(workspaceId)
  if (!canonicalWorkspaceId) throw new Error('workspace runtime requires a canonical workspaceId')
  return canonicalWorkspaceId
}

export function acquireWorkspaceRuntime(userId: string, workspaceId: string, clientId: string): string {
  return acquireWorkspaceRuntimeLease(userId, workspaceId, clientId).workspaceRuntimeId
}

export function acquireWorkspaceRuntimeLease(
  userId: string,
  workspaceId: string,
  clientId: string,
): WorkspaceRuntimeMembershipLeaseEntry {
  const lease = acquireWorkspaceRuntimeMembership(userId, workspaceId, clientId)
  emitWorkspaceRuntimeMembershipAcquired({ userId, clientId })
  return lease
}

function acquireWorkspaceRuntimeMembership(
  userId: string,
  workspaceId: string,
  clientId: string,
): WorkspaceRuntimeMembershipLeaseEntry {
  const canonicalWorkspaceId = requiredCanonicalWorkspaceId(workspaceId)
  if (!clientId) throw new Error('workspace runtime acquire requires clientId')
  const state = workspaceRuntimeState(userId, canonicalWorkspaceId)
  const workspaceRuntimeId = state.currentWorkspaceRuntimeId ?? startWorkspaceRuntimeEpoch(state)
  state.nextMembershipGeneration += 1
  state.members.set(clientId, state.nextMembershipGeneration)
  return { workspaceId: canonicalWorkspaceId, workspaceRuntimeId, generation: state.nextMembershipGeneration }
}

export function releaseWorkspaceRuntime(
  userId: string,
  workspaceId: string,
  workspaceRuntimeId: string,
  clientId: string,
): {
  released: boolean
  runtimeClosed: boolean
} {
  const state = workspaceRuntimesByUser.get(userId)?.get(workspaceId)
  if (!state?.members.has(clientId)) return { released: false, runtimeClosed: false }
  return releaseWorkspaceRuntimeMembershipForCurrentState(userId, clientId, {
    workspaceId: state.workspaceId,
    workspaceRuntimeId,
    generation: state.members.get(clientId)!,
  })
}

export function releaseWorkspaceRuntimeMembershipLease(
  userId: string,
  clientId: string,
  lease: WorkspaceRuntimeMembershipLeaseEntry,
): {
  released: boolean
  runtimeClosed: boolean
} {
  return releaseWorkspaceRuntimeMembershipForCurrentState(userId, clientId, lease)
}

function releaseWorkspaceRuntimeMembershipForCurrentState(
  userId: string,
  clientId: string,
  lease: WorkspaceRuntimeMembershipLeaseEntry,
): {
  released: boolean
  runtimeClosed: boolean
} {
  const state = workspaceRuntimesByUser.get(userId)?.get(lease.workspaceId)
  if (
    !state ||
    state.currentWorkspaceRuntimeId !== lease.workspaceRuntimeId ||
    state.members.get(clientId) !== lease.generation
  ) {
    return { released: false, runtimeClosed: false }
  }
  state.members.delete(clientId)
  if (state.members.size > 0) return { released: true, runtimeClosed: false }
  if (state.activeWorkspaceLifecycleOperations > 0) return { released: true, runtimeClosed: false }
  stopWorkspaceRuntimeEpoch(state)
  emitWorkspaceRuntimeClosed({ userId, workspaceId: lease.workspaceId, workspaceRuntimeId: lease.workspaceRuntimeId })
  return { released: true, runtimeClosed: true }
}

/** Snapshot the membership generations whose liveness was owned by one client. */
export function captureWorkspaceRuntimeMembershipLease(
  userId: string,
  clientId: string,
): WorkspaceRuntimeMembershipLease {
  const entries: WorkspaceRuntimeMembershipLeaseEntry[] = []
  for (const [workspaceId, state] of workspaceRuntimesByUser.get(userId) ?? []) {
    const generation = state.members.get(clientId)
    if (generation === undefined || !state.currentWorkspaceRuntimeId) continue
    entries.push({
      workspaceId: state.workspaceId,
      workspaceRuntimeId: state.currentWorkspaceRuntimeId,
      generation,
    })
  }
  return { userId, clientId, entries }
}

/**
 * Expires only the membership generations captured when presence was lost.
 * A later HTTP acquire renews its generation and cannot be removed by an old
 * disconnect timer, even if the realtime channel is still recovering.
 */
export function expireWorkspaceRuntimeMembershipLease(
  lease: WorkspaceRuntimeMembershipLease,
): WorkspaceRuntimeClosedEvent[] {
  const states = workspaceRuntimesByUser.get(lease.userId)
  if (!states) return []
  const closed: WorkspaceRuntimeClosedEvent[] = []
  for (const entry of lease.entries) {
    const state = states.get(entry.workspaceId)
    if (
      !state ||
      state.currentWorkspaceRuntimeId !== entry.workspaceRuntimeId ||
      state.members.get(lease.clientId) !== entry.generation
    ) {
      continue
    }
    state.members.delete(lease.clientId)
    if (state.members.size > 0 || state.activeWorkspaceLifecycleOperations > 0) continue
    const workspaceRuntimeId = stopWorkspaceRuntimeEpoch(state)
    if (!workspaceRuntimeId) continue
    const event = { userId: lease.userId, workspaceId: entry.workspaceId, workspaceRuntimeId }
    closed.push(event)
    emitWorkspaceRuntimeClosed(event)
  }
  return closed
}

export function listWorkspaceRuntimes(userId: string): WorkspaceRuntimeEntry[] {
  const states = workspaceRuntimesByUser.get(userId)
  if (!states) return []
  const runtimes: WorkspaceRuntimeEntry[] = []
  for (const [workspaceId, state] of states) {
    if (state.currentWorkspaceRuntimeId) {
      runtimes.push({
        workspaceId: state.workspaceId,
        workspaceRuntimeId: state.currentWorkspaceRuntimeId,
        remoteLifecycle: isRemoteRepoId(workspaceId) ? state.remoteLifecycle : null,
        workspaceProbe: exposedWorkspaceProbe(state),
      })
    }
  }
  return runtimes
}

/**
 * Reconciles one window's complete membership declaration in a single
 * synchronous server transaction. Other clients' memberships are untouched.
 */
export function replaceWorkspaceRuntimeMembershipsForClient(
  userId: string,
  clientId: string,
  workspaceIds: readonly string[],
): WorkspaceRuntimeEntry[] {
  const desired = new Set(decodeWorkspaceRuntimeMembershipDeclaration(clientId, workspaceIds))
  const states = workspaceRuntimesByUser.get(userId)
  const closed: WorkspaceRuntimeClosedEvent[] = []
  if (states) {
    for (const [workspaceId, state] of states) {
      if (desired.has(state.workspaceId)) continue
      const workspaceRuntimeId = state.currentWorkspaceRuntimeId
      if (!workspaceRuntimeId || !state.members.delete(clientId) || state.members.size > 0) continue
      if (state.activeWorkspaceLifecycleOperations > 0) continue
      stopWorkspaceRuntimeEpoch(state)
      closed.push({ userId, workspaceId: state.workspaceId, workspaceRuntimeId })
    }
  }
  for (const workspaceId of desired) acquireWorkspaceRuntimeMembership(userId, workspaceId, clientId)
  if (desired.size > 0) emitWorkspaceRuntimeMembershipAcquired({ userId, clientId })
  for (const event of closed) emitWorkspaceRuntimeClosed(event)
  // The runtime query is user-scoped, so return its complete canonical
  // snapshot rather than only this window's declaration.
  return listWorkspaceRuntimes(userId)
}

function decodeWorkspaceRuntimeMembershipDeclaration(
  clientId: string,
  workspaceIds: readonly string[],
): WorkspaceId[] {
  if (!isOpaqueId(clientId)) throw new Error('workspace runtime reconcile requires a valid clientId')
  if (workspaceIds.length > 100) throw new Error('workspace runtime reconcile accepts at most 100 workspace ids')
  return workspaceIds.map(requiredCanonicalWorkspaceId)
}

export function isCurrentWorkspaceRuntime(userId: string, workspaceId: string, workspaceRuntimeId: string): boolean {
  return workspaceRuntimesByUser.get(userId)?.get(workspaceId)?.currentWorkspaceRuntimeId === workspaceRuntimeId
}

export function workspaceRuntimeHasGitCapability(
  userId: string,
  workspaceId: string,
  workspaceRuntimeId: string,
): boolean {
  const state = workspaceRuntimesByUser.get(userId)?.get(workspaceId)
  return (
    state?.currentWorkspaceRuntimeId === workspaceRuntimeId &&
    state.pendingWorkspaceProbeTransition === null &&
    state.workspaceProbe.status === 'ready' &&
    state.workspaceProbe.capabilities.git.status === 'available'
  )
}

export function workspaceProbeStateForRuntime(
  userId: string,
  workspaceId: string,
  workspaceRuntimeId: string,
): WorkspaceProbeState | null {
  const state = workspaceRuntimesByUser.get(userId)?.get(workspaceId)
  return state?.currentWorkspaceRuntimeId === workspaceRuntimeId ? exposedWorkspaceProbe(state) : null
}

export function commitWorkspaceProbeState(input: {
  userId: string
  workspaceId: string
  workspaceRuntimeId: string
  probe: WorkspaceSettledProbeState
}): boolean {
  const state = workspaceRuntimesByUser.get(input.userId)?.get(input.workspaceId)
  if (!state || state.currentWorkspaceRuntimeId !== input.workspaceRuntimeId) return false
  if (state.workspaceProbe.status !== 'probing') return false
  state.workspaceProbe = input.probe
  return true
}

export function commitOrReadInitialWorkspaceProbeState(input: {
  userId: string
  workspaceId: string
  workspaceRuntimeId: string
  probe: WorkspaceSettledProbeState
}): WorkspaceProbeState | null {
  const state = workspaceRuntimesByUser.get(input.userId)?.get(input.workspaceId)
  if (!state || state.currentWorkspaceRuntimeId !== input.workspaceRuntimeId) return null
  if (state.workspaceProbe.status === 'probing') state.workspaceProbe = input.probe
  return state.workspaceProbe
}

export async function runSerializedInitialWorkspaceProbe(input: {
  userId: string
  workspaceId: string
  workspaceRuntimeId: string
  probe: () => Promise<WorkspaceSettledProbeState>
  beforeCommit?: (input: { before: WorkspaceProbeState; after: WorkspaceSettledProbeState }) => Promise<void>
}): Promise<WorkspaceProbeState | null> {
  return await runSerializedWorkspaceLifecycleOperation(input, async (state) => {
    if (state.workspaceProbe.status !== 'probing') return state.workspaceProbe
    const probe = await input.probe()
    if (state.currentWorkspaceRuntimeId !== input.workspaceRuntimeId) return null
    if (state.workspaceProbe.status !== 'probing') return state.workspaceProbe
    const before = state.workspaceProbe
    state.workspaceProbe = probe
    state.pendingWorkspaceProbeTransition = { before, after: probe }
    try {
      await input.beforeCommit?.({ before, after: probe })
    } catch (error) {
      if (state.currentWorkspaceRuntimeId !== input.workspaceRuntimeId) return null
      state.workspaceProbe = before
      state.pendingWorkspaceProbeTransition = null
      throw error
    }
    if (state.currentWorkspaceRuntimeId !== input.workspaceRuntimeId) return null
    state.pendingWorkspaceProbeTransition = null
    return probe
  })
}

export async function runSerializedWorkspaceRefresh(input: {
  userId: string
  workspaceId: string
  workspaceRuntimeId: string
  probe: () => Promise<WorkspaceSettledProbeState>
  beforeCommit?: (input: { before: WorkspaceProbeState; after: WorkspaceSettledProbeState }) => Promise<void>
}): Promise<WorkspaceRefreshResult> {
  const result = await runSerializedWorkspaceLifecycleOperation(
    input,
    async (state): Promise<WorkspaceRefreshResult> => {
      if (state.currentWorkspaceRuntimeId !== input.workspaceRuntimeId) return { kind: 'stale-runtime' }
      const probe = await input.probe()
      if (state.currentWorkspaceRuntimeId !== input.workspaceRuntimeId) return { kind: 'stale-runtime' }
      if (workspaceRefreshMayCommit(probe)) {
        const before = state.workspaceProbe
        state.workspaceProbe = probe
        state.pendingWorkspaceProbeTransition = { before, after: probe }
        try {
          await input.beforeCommit?.({ before, after: probe })
        } catch (error) {
          if (state.currentWorkspaceRuntimeId !== input.workspaceRuntimeId) return { kind: 'stale-runtime' }
          state.workspaceProbe = before
          state.pendingWorkspaceProbeTransition = null
          throw error
        }
        if (state.currentWorkspaceRuntimeId !== input.workspaceRuntimeId) return { kind: 'stale-runtime' }
        state.pendingWorkspaceProbeTransition = null
        return { kind: 'committed', probe }
      }
      return { kind: 'failed', probe }
    },
  )
  return result ?? { kind: 'stale-runtime' }
}

async function runSerializedWorkspaceLifecycleOperation<T>(
  input: { userId: string; workspaceId: string; workspaceRuntimeId: string },
  operation: (state: WorkspaceRuntimeState) => Promise<T>,
): Promise<T | null> {
  const state = workspaceRuntimesByUser.get(input.userId)?.get(input.workspaceId)
  if (!state || state.currentWorkspaceRuntimeId !== input.workspaceRuntimeId) return null
  state.activeWorkspaceLifecycleOperations += 1
  const predecessor = state.workspaceLifecycleTail
  let releaseTurn!: () => void
  const turn = new Promise<void>((resolve) => {
    releaseTurn = resolve
  })
  state.workspaceLifecycleTail = predecessor.then(async () => await turn)
  await predecessor
  try {
    if (state.currentWorkspaceRuntimeId !== input.workspaceRuntimeId) return null
    return await operation(state)
  } finally {
    releaseTurn()
    releaseWorkspaceLifecycleOperation(input, state)
  }
}

function releaseWorkspaceLifecycleOperation(
  input: { userId: string; workspaceId: string; workspaceRuntimeId: string },
  state: WorkspaceRuntimeState,
): void {
  state.activeWorkspaceLifecycleOperations -= 1
  if (state.activeWorkspaceLifecycleOperations < 0) {
    throw new Error('workspace lifecycle operation lease underflow')
  }
  if (
    state.activeWorkspaceLifecycleOperations > 0 ||
    state.members.size > 0 ||
    state.currentWorkspaceRuntimeId !== input.workspaceRuntimeId ||
    workspaceRuntimesByUser.get(input.userId)?.get(input.workspaceId) !== state
  ) {
    return
  }
  stopWorkspaceRuntimeEpoch(state)
  emitWorkspaceRuntimeClosed({
    userId: input.userId,
    workspaceId: state.workspaceId,
    workspaceRuntimeId: input.workspaceRuntimeId,
  })
}

function workspaceRefreshMayCommit(probe: WorkspaceSettledProbeState): boolean {
  return probe.status === 'ready' && probe.diagnostics.length === 0
}

function exposedWorkspaceProbe(state: WorkspaceRuntimeState): WorkspaceProbeState {
  return state.pendingWorkspaceProbeTransition ? { status: 'probing' } : state.workspaceProbe
}

export function isCurrentWorkspaceRuntimeMembership(
  userId: string,
  workspaceId: string,
  workspaceRuntimeId: string,
  clientId: string,
): boolean {
  const state = workspaceRuntimesByUser.get(userId)?.get(workspaceId)
  return state?.currentWorkspaceRuntimeId === workspaceRuntimeId && state.members.has(clientId)
}

export function failRepoRemoteLifecycle(input: {
  userId: string
  workspaceId: string
  workspaceRuntimeId: string
  reason: RemoteRepoFailureReason
  target?: RemoteRepoTarget
}): RepoRemoteLifecycleFailResult {
  if (!isRemoteRepoId(input.workspaceId)) return { kind: 'not-remote' }
  const state = workspaceRuntimesByUser.get(input.userId)?.get(input.workspaceId)
  if (!state || state.currentWorkspaceRuntimeId !== input.workspaceRuntimeId) return { kind: 'stale-runtime' }

  state.remoteAttemptController?.abort()
  state.remoteAttemptController = null
  state.remoteAttemptPromise = null
  const attemptId = state.remoteLifecycle.attemptId + 1
  const target = input.target ?? remoteLifecycleTarget(state.remoteLifecycle) ?? undefined
  state.remoteLifecycle = {
    kind: 'failed',
    attemptId,
    reason: input.reason,
    ...(target ? { target } : {}),
  }
  state.remoteName = state.remoteName ?? target?.displayName ?? input.workspaceId
  return { kind: 'settled', name: state.remoteName, lifecycle: state.remoteLifecycle }
}

export async function runRepoRemoteLifecycle(
  userId: string,
  workspaceId: string,
  workspaceRuntimeId: string,
  resolve: (signal: AbortSignal) => Promise<RemoteRepoConnectionResult>,
  onTransition: (lifecycle: RemoteRepoRuntimeLifecycle) => void = () => {},
  mode: 'restart' | 'ensure' = 'restart',
): Promise<RepoRemoteLifecycleRunResult> {
  const state = workspaceRuntimesByUser.get(userId)?.get(workspaceId)
  if (!state || state.currentWorkspaceRuntimeId !== workspaceRuntimeId) return { kind: 'stale-runtime' }

  if (mode === 'ensure') {
    const joined = await joinRepoRemoteLifecycleAttempt(state, workspaceRuntimeId)
    if (joined) return joined
    if (state.remoteLifecycle.kind === 'ready') {
      return settledRepoRemoteLifecycleResult(state, workspaceId)
    }
  }

  state.remoteAttemptController?.abort()
  const controller = new AbortController()
  const attemptId = state.remoteLifecycle.attemptId + 1
  state.remoteAttemptController = controller
  state.remoteLifecycle = { kind: 'connecting', attemptId }
  notifyRemoteLifecycleTransition(onTransition, state.remoteLifecycle, workspaceId)

  const attemptPromise = settleRepoRemoteLifecycleAttempt(
    state,
    workspaceId,
    workspaceRuntimeId,
    controller,
    attemptId,
    resolve,
    onTransition,
  )
  state.remoteAttemptPromise = attemptPromise
  try {
    return await attemptPromise
  } finally {
    if (state.remoteAttemptPromise === attemptPromise) state.remoteAttemptPromise = null
  }
}

async function joinRepoRemoteLifecycleAttempt(
  state: WorkspaceRuntimeState,
  workspaceRuntimeId: string,
): Promise<RepoRemoteLifecycleRunResult | null> {
  while (state.currentWorkspaceRuntimeId === workspaceRuntimeId && state.remoteLifecycle.kind === 'connecting') {
    const attempt = state.remoteAttemptPromise
    if (!attempt) return null
    const result = await attempt
    if (
      result.kind === 'superseded' &&
      state.currentWorkspaceRuntimeId === workspaceRuntimeId &&
      state.remoteLifecycle.kind === 'connecting'
    ) {
      continue
    }
    return result
  }
  if (state.currentWorkspaceRuntimeId !== workspaceRuntimeId) return { kind: 'stale-runtime' }
  return null
}

async function settleRepoRemoteLifecycleAttempt(
  state: WorkspaceRuntimeState,
  workspaceId: string,
  workspaceRuntimeId: string,
  controller: AbortController,
  attemptId: number,
  resolve: (signal: AbortSignal) => Promise<RemoteRepoConnectionResult>,
  onTransition: (lifecycle: RemoteRepoRuntimeLifecycle) => void,
): Promise<RepoRemoteLifecycleRunResult> {
  try {
    const result = await resolve(controller.signal)
    if (
      state.currentWorkspaceRuntimeId !== workspaceRuntimeId ||
      state.remoteAttemptController !== controller ||
      state.remoteLifecycle.attemptId !== attemptId
    ) {
      return supersededRemoteLifecycleResult(state, workspaceRuntimeId)
    }
    state.remoteLifecycle =
      result.kind === 'ready'
        ? { kind: 'ready', attemptId, target: result.lifecycle.target }
        : {
            kind: 'failed',
            attemptId,
            reason: result.lifecycle.reason,
            ...(result.lifecycle.target ? { target: result.lifecycle.target } : {}),
          }
    state.remoteName = result.name
    notifyRemoteLifecycleTransition(onTransition, state.remoteLifecycle, workspaceId)
    return settledRepoRemoteLifecycleResult(state, workspaceId)
  } catch (error) {
    if (
      state.currentWorkspaceRuntimeId !== workspaceRuntimeId ||
      state.remoteAttemptController !== controller ||
      state.remoteLifecycle.attemptId !== attemptId
    ) {
      return supersededRemoteLifecycleResult(state, workspaceRuntimeId)
    }
    state.remoteLifecycle = { kind: 'failed', attemptId, reason: 'unknown' }
    state.remoteName = workspaceId
    notifyRemoteLifecycleTransition(onTransition, state.remoteLifecycle, workspaceId)
    return settledRepoRemoteLifecycleResult(state, workspaceId)
  } finally {
    if (state.remoteAttemptController === controller) state.remoteAttemptController = null
  }
}

function settledRepoRemoteLifecycleResult(
  state: WorkspaceRuntimeState,
  workspaceId: string,
): Extract<RepoRemoteLifecycleRunResult, { kind: 'settled' }> {
  if (state.remoteLifecycle.kind !== 'ready' && state.remoteLifecycle.kind !== 'failed') {
    throw new Error('repo remote lifecycle must be terminal before it settles')
  }
  if (state.remoteName === null) throw new Error(`repo remote lifecycle name is missing for ${workspaceId}`)
  return { kind: 'settled', name: state.remoteName, lifecycle: state.remoteLifecycle }
}

function remoteLifecycleTarget(lifecycle: RemoteRepoRuntimeLifecycle): RemoteRepoTarget | null {
  return lifecycle.kind === 'ready' || lifecycle.kind === 'failed' ? (lifecycle.target ?? null) : null
}

function supersededRemoteLifecycleResult(
  state: WorkspaceRuntimeState,
  workspaceRuntimeId: string,
): RepoRemoteLifecycleRunResult {
  return state.currentWorkspaceRuntimeId === workspaceRuntimeId ? { kind: 'superseded' } : { kind: 'stale-runtime' }
}

function notifyRemoteLifecycleTransition(
  listener: (lifecycle: RemoteRepoRuntimeLifecycle) => void,
  lifecycle: RemoteRepoRuntimeLifecycle,
  workspaceId: string,
): void {
  try {
    listener(lifecycle)
  } catch (err) {
    workspaceRuntimeLogger.warn(
      { err, workspaceId, attemptId: lifecycle.attemptId },
      'remote lifecycle transition listener failed',
    )
  }
}

/** Test reset only. Production closes runtimes through membership release. */
export function clearWorkspaceRuntimesForUser(userId: string): void {
  const states = workspaceRuntimesByUser.get(userId)
  if (states) {
    for (const [workspaceId, state] of states) {
      if (state.activeWorkspaceLifecycleOperations > 0) {
        throw new Error(`cannot reset workspace runtimes with active workspace lifecycle operations for ${workspaceId}`)
      }
      const workspaceRuntimeId = stopWorkspaceRuntimeEpoch(state)
      if (workspaceRuntimeId) {
        emitWorkspaceRuntimeClosed({
          userId,
          workspaceId: state.workspaceId,
          workspaceRuntimeId,
        })
      }
    }
  }
  workspaceRuntimesByUser.delete(userId)
}

function startWorkspaceRuntimeEpoch(state: WorkspaceRuntimeState): string {
  if (
    state.currentWorkspaceRuntimeId ||
    state.remoteAttemptController ||
    state.remoteAttemptPromise ||
    state.activeWorkspaceLifecycleOperations > 0
  ) {
    throw new Error('workspace runtime epoch must stop before it starts')
  }
  const workspaceRuntimeId = createOpaqueId('workspace-runtime')
  state.currentWorkspaceRuntimeId = workspaceRuntimeId
  state.members.clear()
  state.nextMembershipGeneration = 0
  state.remoteLifecycle = { kind: 'idle', attemptId: 0 }
  state.remoteName = null
  return workspaceRuntimeId
}

function stopWorkspaceRuntimeEpoch(state: WorkspaceRuntimeState): string | null {
  const workspaceRuntimeId = state.currentWorkspaceRuntimeId
  state.remoteAttemptController?.abort()
  state.remoteAttemptController = null
  state.remoteAttemptPromise = null
  state.workspaceProbe = { status: 'probing' }
  state.pendingWorkspaceProbeTransition = null
  state.currentWorkspaceRuntimeId = null
  state.members.clear()
  return workspaceRuntimeId
}

export function onWorkspaceRuntimeClosed(listener: (event: WorkspaceRuntimeClosedEvent) => void): () => void {
  workspaceRuntimeClosedListeners.add(listener)
  return () => {
    workspaceRuntimeClosedListeners.delete(listener)
  }
}

export function onWorkspaceRuntimeMembershipAcquired(
  listener: (event: WorkspaceRuntimeMembershipAcquiredEvent) => void,
): () => void {
  workspaceRuntimeMembershipAcquiredListeners.add(listener)
  return () => {
    workspaceRuntimeMembershipAcquiredListeners.delete(listener)
  }
}

function emitWorkspaceRuntimeClosed(event: WorkspaceRuntimeClosedEvent): void {
  for (const listener of workspaceRuntimeClosedListeners) {
    try {
      listener(event)
    } catch (err) {
      workspaceRuntimeLogger.warn({ err, workspaceId: event.workspaceId }, 'workspace runtime close listener failed')
    }
  }
}

function emitWorkspaceRuntimeMembershipAcquired(event: WorkspaceRuntimeMembershipAcquiredEvent): void {
  for (const listener of workspaceRuntimeMembershipAcquiredListeners) {
    try {
      listener(event)
    } catch (err) {
      workspaceRuntimeLogger.warn(
        { err, userId: event.userId, clientId: event.clientId },
        'membership acquire listener failed',
      )
    }
  }
}
