import { createOpaqueId, isOpaqueId } from '#/shared/opaque-id.ts'
import { serverLogger } from '#/server/logger.ts'
import type {
  RemoteRepoConnectionResult,
  RemoteRepoFailureReason,
  RemoteRepoRuntimeLifecycle,
  RemoteRepoTarget,
} from '#/shared/remote-repo.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'

interface RepoRuntimeState {
  currentRepoRuntimeId: string | null
  members: Map<string, number>
  nextMembershipGeneration: number
  remoteLifecycle: RemoteRepoRuntimeLifecycle
  remoteName: string | null
  remoteAttemptController: AbortController | null
  remoteAttemptPromise: Promise<RepoRemoteLifecycleRunResult> | null
}

export interface RepoRuntimeClosedEvent {
  userId: string
  repoRoot: string
  repoRuntimeId: string
}

export interface RepoRuntimeMembershipAcquiredEvent {
  userId: string
  clientId: string
}

export interface RepoRuntimeEntry {
  repoRoot: string
  repoRuntimeId: string
  remoteLifecycle: RemoteRepoRuntimeLifecycle | null
}

export interface RepoRuntimeMembershipLeaseEntry {
  repoRoot: string
  repoRuntimeId: string
  generation: number
}

export interface RepoRuntimeMembershipLease {
  userId: string
  clientId: string
  entries: RepoRuntimeMembershipLeaseEntry[]
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

const repoRuntimesByUser = new Map<string, Map<string, RepoRuntimeState>>()
const repoRuntimeClosedListeners = new Set<(event: RepoRuntimeClosedEvent) => void>()
const repoRuntimeMembershipAcquiredListeners = new Set<(event: RepoRuntimeMembershipAcquiredEvent) => void>()
const repoRuntimeLogger = serverLogger.child({ tag: 'repo-runtime' })

function repoRuntimeStateByUser(userId: string): Map<string, RepoRuntimeState> {
  let states = repoRuntimesByUser.get(userId)
  if (states) return states
  states = new Map<string, RepoRuntimeState>()
  repoRuntimesByUser.set(userId, states)
  return states
}

function repoRuntimeState(userId: string, repoRoot: string): RepoRuntimeState {
  const byRepo = repoRuntimeStateByUser(userId)
  const existing = byRepo.get(repoRoot)
  if (existing) return existing
  const created: RepoRuntimeState = {
    currentRepoRuntimeId: null,
    members: new Map(),
    nextMembershipGeneration: 0,
    remoteLifecycle: { kind: 'idle', attemptId: 0 },
    remoteName: null,
    remoteAttemptController: null,
    remoteAttemptPromise: null,
  }
  byRepo.set(repoRoot, created)
  return created
}

export function acquireRepoRuntime(userId: string, repoRoot: string, clientId: string): string {
  return acquireRepoRuntimeLease(userId, repoRoot, clientId).repoRuntimeId
}

export function acquireRepoRuntimeLease(
  userId: string,
  repoRoot: string,
  clientId: string,
): RepoRuntimeMembershipLeaseEntry {
  const lease = acquireRepoRuntimeMembership(userId, repoRoot, clientId)
  emitRepoRuntimeMembershipAcquired({ userId, clientId })
  return lease
}

function acquireRepoRuntimeMembership(userId: string, repoRoot: string, clientId: string): RepoRuntimeMembershipLeaseEntry {
  if (!repoRoot) throw new Error('repo runtime open requires repoRoot')
  if (!clientId) throw new Error('repo runtime acquire requires clientId')
  const state = repoRuntimeState(userId, repoRoot)
  const repoRuntimeId = state.currentRepoRuntimeId ?? startRepoRuntimeEpoch(state)
  state.nextMembershipGeneration += 1
  state.members.set(clientId, state.nextMembershipGeneration)
  return { repoRoot, repoRuntimeId, generation: state.nextMembershipGeneration }
}

export function releaseRepoRuntime(
  userId: string,
  repoRoot: string,
  repoRuntimeId: string,
  clientId: string,
): {
  released: boolean
  runtimeClosed: boolean
} {
  const state = repoRuntimesByUser.get(userId)?.get(repoRoot)
  if (!state?.members.has(clientId)) return { released: false, runtimeClosed: false }
  return releaseRepoRuntimeMembershipForCurrentState(userId, clientId, {
    repoRoot,
    repoRuntimeId,
    generation: state.members.get(clientId)!,
  })
}

export function releaseRepoRuntimeMembershipLease(
  userId: string,
  clientId: string,
  lease: RepoRuntimeMembershipLeaseEntry,
): {
  released: boolean
  runtimeClosed: boolean
} {
  return releaseRepoRuntimeMembershipForCurrentState(userId, clientId, lease)
}

function releaseRepoRuntimeMembershipForCurrentState(
  userId: string,
  clientId: string,
  lease: RepoRuntimeMembershipLeaseEntry,
): {
  released: boolean
  runtimeClosed: boolean
} {
  const state = repoRuntimesByUser.get(userId)?.get(lease.repoRoot)
  if (
    !state ||
    state.currentRepoRuntimeId !== lease.repoRuntimeId ||
    state.members.get(clientId) !== lease.generation
  ) {
    return { released: false, runtimeClosed: false }
  }
  state.members.delete(clientId)
  if (state.members.size > 0) return { released: true, runtimeClosed: false }
  stopRepoRuntimeEpoch(state)
  emitRepoRuntimeClosed({ userId, repoRoot: lease.repoRoot, repoRuntimeId: lease.repoRuntimeId })
  return { released: true, runtimeClosed: true }
}

/** Snapshot the membership generations whose liveness was owned by one client. */
export function captureRepoRuntimeMembershipLease(userId: string, clientId: string): RepoRuntimeMembershipLease {
  const entries: RepoRuntimeMembershipLeaseEntry[] = []
  for (const [repoRoot, state] of repoRuntimesByUser.get(userId) ?? []) {
    const generation = state.members.get(clientId)
    if (generation === undefined || !state.currentRepoRuntimeId) continue
    entries.push({ repoRoot, repoRuntimeId: state.currentRepoRuntimeId, generation })
  }
  return { userId, clientId, entries }
}

/**
 * Expires only the membership generations captured when presence was lost.
 * A later HTTP acquire renews its generation and cannot be removed by an old
 * disconnect timer, even if the realtime channel is still recovering.
 */
export function expireRepoRuntimeMembershipLease(lease: RepoRuntimeMembershipLease): RepoRuntimeClosedEvent[] {
  const states = repoRuntimesByUser.get(lease.userId)
  if (!states) return []
  const closed: RepoRuntimeClosedEvent[] = []
  for (const entry of lease.entries) {
    const state = states.get(entry.repoRoot)
    if (
      !state ||
      state.currentRepoRuntimeId !== entry.repoRuntimeId ||
      state.members.get(lease.clientId) !== entry.generation
    ) {
      continue
    }
    state.members.delete(lease.clientId)
    if (state.members.size > 0) continue
    const repoRuntimeId = stopRepoRuntimeEpoch(state)
    if (!repoRuntimeId) continue
    const event = { userId: lease.userId, repoRoot: entry.repoRoot, repoRuntimeId }
    closed.push(event)
    emitRepoRuntimeClosed(event)
  }
  return closed
}

export function listRepoRuntimes(userId: string): RepoRuntimeEntry[] {
  const states = repoRuntimesByUser.get(userId)
  if (!states) return []
  const runtimes: RepoRuntimeEntry[] = []
  for (const [repoRoot, state] of states) {
    if (state.currentRepoRuntimeId) {
      runtimes.push({
        repoRoot,
        repoRuntimeId: state.currentRepoRuntimeId,
        remoteLifecycle: isRemoteRepoId(repoRoot) ? state.remoteLifecycle : null,
      })
    }
  }
  return runtimes
}

/**
 * Reconciles one window's complete membership declaration in a single
 * synchronous server transaction. Other clients' memberships are untouched.
 */
export function replaceRepoRuntimeMembershipsForClient(
  userId: string,
  clientId: string,
  repoRoots: readonly string[],
): RepoRuntimeEntry[] {
  assertValidRepoRuntimeMembershipDeclaration(clientId, repoRoots)
  const desired = new Set(repoRoots)
  const states = repoRuntimesByUser.get(userId)
  const closed: RepoRuntimeClosedEvent[] = []
  if (states) {
    for (const [repoRoot, state] of states) {
      if (desired.has(repoRoot)) continue
      const repoRuntimeId = state.currentRepoRuntimeId
      if (!repoRuntimeId || !state.members.delete(clientId) || state.members.size > 0) continue
      stopRepoRuntimeEpoch(state)
      closed.push({ userId, repoRoot, repoRuntimeId })
    }
  }
  for (const repoRoot of desired) acquireRepoRuntimeMembership(userId, repoRoot, clientId)
  if (desired.size > 0) emitRepoRuntimeMembershipAcquired({ userId, clientId })
  for (const event of closed) emitRepoRuntimeClosed(event)
  // The runtime query is user-scoped, so return its complete canonical
  // snapshot rather than only this window's declaration.
  return listRepoRuntimes(userId)
}

function assertValidRepoRuntimeMembershipDeclaration(clientId: string, repoRoots: readonly string[]): void {
  if (!isOpaqueId(clientId)) throw new Error('repo runtime reconcile requires a valid clientId')
  if (repoRoots.length > 100) throw new Error('repo runtime reconcile accepts at most 100 repo roots')
  for (const repoRoot of repoRoots) {
    if (!repoRoot) throw new Error('repo runtime reconcile requires non-empty repo roots')
  }
}

export function isCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): boolean {
  return repoRuntimesByUser.get(userId)?.get(repoRoot)?.currentRepoRuntimeId === repoRuntimeId
}

export function failRepoRemoteLifecycle(input: {
  userId: string
  repoRoot: string
  repoRuntimeId: string
  reason: RemoteRepoFailureReason
  target?: RemoteRepoTarget
}): RepoRemoteLifecycleFailResult {
  if (!isRemoteRepoId(input.repoRoot)) return { kind: 'not-remote' }
  const state = repoRuntimesByUser.get(input.userId)?.get(input.repoRoot)
  if (!state || state.currentRepoRuntimeId !== input.repoRuntimeId) return { kind: 'stale-runtime' }

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
  state.remoteName = state.remoteName ?? target?.displayName ?? input.repoRoot
  return { kind: 'settled', name: state.remoteName, lifecycle: state.remoteLifecycle }
}

export async function runRepoRemoteLifecycle(
  userId: string,
  repoRoot: string,
  repoRuntimeId: string,
  resolve: (signal: AbortSignal) => Promise<RemoteRepoConnectionResult>,
  onTransition: (lifecycle: RemoteRepoRuntimeLifecycle) => void = () => {},
  mode: 'restart' | 'ensure' = 'restart',
): Promise<RepoRemoteLifecycleRunResult> {
  const state = repoRuntimesByUser.get(userId)?.get(repoRoot)
  if (!state || state.currentRepoRuntimeId !== repoRuntimeId) return { kind: 'stale-runtime' }

  if (mode === 'ensure') {
    const joined = await joinRepoRemoteLifecycleAttempt(state, repoRuntimeId)
    if (joined) return joined
    if (state.remoteLifecycle.kind === 'ready' || state.remoteLifecycle.kind === 'failed') {
      return settledRepoRemoteLifecycleResult(state, repoRoot)
    }
  }

  state.remoteAttemptController?.abort()
  const controller = new AbortController()
  const attemptId = state.remoteLifecycle.attemptId + 1
  state.remoteAttemptController = controller
  state.remoteLifecycle = { kind: 'connecting', attemptId }
  notifyRemoteLifecycleTransition(onTransition, state.remoteLifecycle, repoRoot)

  const attemptPromise = settleRepoRemoteLifecycleAttempt(
    state,
    repoRoot,
    repoRuntimeId,
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
  state: RepoRuntimeState,
  repoRuntimeId: string,
): Promise<RepoRemoteLifecycleRunResult | null> {
  while (state.currentRepoRuntimeId === repoRuntimeId && state.remoteLifecycle.kind === 'connecting') {
    const attempt = state.remoteAttemptPromise
    if (!attempt) return null
    const result = await attempt
    if (
      result.kind === 'superseded' &&
      state.currentRepoRuntimeId === repoRuntimeId &&
      state.remoteLifecycle.kind === 'connecting'
    ) {
      continue
    }
    return result
  }
  if (state.currentRepoRuntimeId !== repoRuntimeId) return { kind: 'stale-runtime' }
  return null
}

async function settleRepoRemoteLifecycleAttempt(
  state: RepoRuntimeState,
  repoRoot: string,
  repoRuntimeId: string,
  controller: AbortController,
  attemptId: number,
  resolve: (signal: AbortSignal) => Promise<RemoteRepoConnectionResult>,
  onTransition: (lifecycle: RemoteRepoRuntimeLifecycle) => void,
): Promise<RepoRemoteLifecycleRunResult> {
  try {
    const result = await resolve(controller.signal)
    if (
      state.currentRepoRuntimeId !== repoRuntimeId ||
      state.remoteAttemptController !== controller ||
      state.remoteLifecycle.attemptId !== attemptId
    ) {
      return supersededRemoteLifecycleResult(state, repoRuntimeId)
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
    notifyRemoteLifecycleTransition(onTransition, state.remoteLifecycle, repoRoot)
    return settledRepoRemoteLifecycleResult(state, repoRoot)
  } catch (error) {
    if (
      state.currentRepoRuntimeId !== repoRuntimeId ||
      state.remoteAttemptController !== controller ||
      state.remoteLifecycle.attemptId !== attemptId
    ) {
      return supersededRemoteLifecycleResult(state, repoRuntimeId)
    }
    state.remoteLifecycle = { kind: 'failed', attemptId, reason: 'unknown' }
    state.remoteName = repoRoot
    notifyRemoteLifecycleTransition(onTransition, state.remoteLifecycle, repoRoot)
    return settledRepoRemoteLifecycleResult(state, repoRoot)
  } finally {
    if (state.remoteAttemptController === controller) state.remoteAttemptController = null
  }
}

function settledRepoRemoteLifecycleResult(
  state: RepoRuntimeState,
  repoRoot: string,
): Extract<RepoRemoteLifecycleRunResult, { kind: 'settled' }> {
  if (state.remoteLifecycle.kind !== 'ready' && state.remoteLifecycle.kind !== 'failed') {
    throw new Error('repo remote lifecycle must be terminal before it settles')
  }
  if (state.remoteName === null) throw new Error(`repo remote lifecycle name is missing for ${repoRoot}`)
  return { kind: 'settled', name: state.remoteName, lifecycle: state.remoteLifecycle }
}

function remoteLifecycleTarget(lifecycle: RemoteRepoRuntimeLifecycle): RemoteRepoTarget | null {
  return lifecycle.kind === 'ready' || lifecycle.kind === 'failed' ? (lifecycle.target ?? null) : null
}

function supersededRemoteLifecycleResult(state: RepoRuntimeState, repoRuntimeId: string): RepoRemoteLifecycleRunResult {
  return state.currentRepoRuntimeId === repoRuntimeId ? { kind: 'superseded' } : { kind: 'stale-runtime' }
}

function notifyRemoteLifecycleTransition(
  listener: (lifecycle: RemoteRepoRuntimeLifecycle) => void,
  lifecycle: RemoteRepoRuntimeLifecycle,
  repoRoot: string,
): void {
  try {
    listener(lifecycle)
  } catch (err) {
    repoRuntimeLogger.warn(
      { err, repoRoot, attemptId: lifecycle.attemptId },
      'remote lifecycle transition listener failed',
    )
  }
}

export function clearRepoRuntimesForUser(userId: string): void {
  const states = repoRuntimesByUser.get(userId)
  if (states) {
    for (const [repoRoot, state] of states) {
      const repoRuntimeId = stopRepoRuntimeEpoch(state)
      if (repoRuntimeId) emitRepoRuntimeClosed({ userId, repoRoot, repoRuntimeId })
    }
  }
  repoRuntimesByUser.delete(userId)
}

function startRepoRuntimeEpoch(state: RepoRuntimeState): string {
  if (state.currentRepoRuntimeId || state.remoteAttemptController || state.remoteAttemptPromise) {
    throw new Error('repo runtime epoch must stop before it starts')
  }
  const repoRuntimeId = createOpaqueId('repo-runtime')
  state.currentRepoRuntimeId = repoRuntimeId
  state.members.clear()
  state.nextMembershipGeneration = 0
  state.remoteLifecycle = { kind: 'idle', attemptId: 0 }
  state.remoteName = null
  return repoRuntimeId
}

function stopRepoRuntimeEpoch(state: RepoRuntimeState): string | null {
  const repoRuntimeId = state.currentRepoRuntimeId
  state.remoteAttemptController?.abort()
  state.remoteAttemptController = null
  state.remoteAttemptPromise = null
  state.currentRepoRuntimeId = null
  state.members.clear()
  return repoRuntimeId
}

export function onRepoRuntimeClosed(listener: (event: RepoRuntimeClosedEvent) => void): () => void {
  repoRuntimeClosedListeners.add(listener)
  return () => {
    repoRuntimeClosedListeners.delete(listener)
  }
}

export function onRepoRuntimeMembershipAcquired(
  listener: (event: RepoRuntimeMembershipAcquiredEvent) => void,
): () => void {
  repoRuntimeMembershipAcquiredListeners.add(listener)
  return () => {
    repoRuntimeMembershipAcquiredListeners.delete(listener)
  }
}

function emitRepoRuntimeClosed(event: RepoRuntimeClosedEvent): void {
  for (const listener of repoRuntimeClosedListeners) {
    try {
      listener(event)
    } catch (err) {
      repoRuntimeLogger.warn({ err, repoRoot: event.repoRoot }, 'repo runtime close listener failed')
    }
  }
}

function emitRepoRuntimeMembershipAcquired(event: RepoRuntimeMembershipAcquiredEvent): void {
  for (const listener of repoRuntimeMembershipAcquiredListeners) {
    try {
      listener(event)
    } catch (err) {
      repoRuntimeLogger.warn(
        { err, userId: event.userId, clientId: event.clientId },
        'membership acquire listener failed',
      )
    }
  }
}
