import { createOpaqueId, isOpaqueId } from '#/shared/opaque-id.ts'
import { serverLogger } from '#/server/logger.ts'
import type {
  RemoteWorkspaceConnectionResult,
  RemoteWorkspaceFailureReason,
  RemoteWorkspaceRuntimeLifecycle,
  RemoteWorkspaceTarget,
} from '#/shared/remote-workspace.ts'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import type {
  WorkspaceProbeState,
  WorkspaceRefreshResult,
  WorkspaceSettledProbeState,
} from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

interface WorkspaceRuntimeState {
  workspaceId: WorkspaceId
  currentWorkspaceRuntimeId: string | null
  members: Map<string, number>
  nextMembershipGeneration: number
  remoteLifecycle: RemoteWorkspaceRuntimeLifecycle
  remoteAttemptController: AbortController | null
  remoteAttemptPromise: Promise<RemoteWorkspaceLifecycleRunResult> | null
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

export interface WorkspaceRuntimeMembershipReleasedEvent {
  userId: string
  clientId: string
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  hasRemainingMemberships: boolean
}

export interface WorkspaceRuntimeEntry {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  remoteLifecycle: RemoteWorkspaceRuntimeLifecycle | null
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

type TerminalRemoteLifecycle = Extract<RemoteWorkspaceRuntimeLifecycle, { kind: 'ready' | 'failed' }>

export type RemoteWorkspaceLifecycleRunResult =
  | { kind: 'settled'; name: string; lifecycle: TerminalRemoteLifecycle }
  | { kind: 'superseded' }
  | { kind: 'stale-runtime' }

export type RemoteWorkspaceLifecycleFailResult =
  | { kind: 'settled'; name: string; lifecycle: Extract<RemoteWorkspaceRuntimeLifecycle, { kind: 'failed' }> }
  | { kind: 'not-remote' }
  | { kind: 'stale-runtime' }

export interface RemoteWorkspaceTerminalCommitPlan {
  workspaceProbe?: {
    mode: 'initial-only' | 'refresh'
    probe: WorkspaceSettledProbeState
    beforeCommit?: (input: { before: WorkspaceProbeState; after: WorkspaceSettledProbeState }) => Promise<void>
  }
}

const workspaceRuntimesByUser = new Map<string, Map<WorkspaceId, WorkspaceRuntimeState>>()
const workspaceRuntimeClosedListeners = new Set<(event: WorkspaceRuntimeClosedEvent) => void>()
const workspaceRuntimeMembershipAcquiredListeners = new Set<(event: WorkspaceRuntimeMembershipAcquiredEvent) => void>()
const workspaceRuntimeMembershipReleasedListeners = new Set<(event: WorkspaceRuntimeMembershipReleasedEvent) => void>()
const workspaceRuntimeAdmissionTails = new Map<string, Promise<void>>()
const workspaceRuntimeLogger = serverLogger.child({ tag: 'workspace-runtime' })

function workspaceRuntimeStateByUser(userId: string): Map<WorkspaceId, WorkspaceRuntimeState> {
  let states = workspaceRuntimesByUser.get(userId)
  if (states) return states
  states = new Map<WorkspaceId, WorkspaceRuntimeState>()
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

export function acquireWorkspaceRuntime(userId: string, workspaceId: WorkspaceId, clientId: string): string {
  return acquireWorkspaceRuntimeLease(userId, workspaceId, clientId).workspaceRuntimeId
}

/**
 * Admit one client for work that must finish before the caller can own the
 * membership. A failed admission restores that client's exact preceding
 * generation without disturbing memberships acquired by other clients.
 */
export async function withWorkspaceRuntimeAdmission<T>(
  userId: string,
  workspaceId: WorkspaceId,
  clientId: string,
  admit: (workspaceRuntimeId: string) => Promise<T>,
): Promise<T> {
  const admissionKey = [userId, workspaceId, clientId].join('\0')
  const predecessor = workspaceRuntimeAdmissionTails.get(admissionKey) ?? Promise.resolve()
  let releaseTurn!: () => void
  const turn = new Promise<void>((resolve) => {
    releaseTurn = resolve
  })
  const tail = predecessor.then(async () => await turn)
  workspaceRuntimeAdmissionTails.set(admissionKey, tail)
  await predecessor
  try {
    return await runWorkspaceRuntimeAdmission(userId, workspaceId, clientId, admit)
  } finally {
    releaseTurn()
    if (workspaceRuntimeAdmissionTails.get(admissionKey) === tail) workspaceRuntimeAdmissionTails.delete(admissionKey)
  }
}

async function runWorkspaceRuntimeAdmission<T>(
  userId: string,
  workspaceId: WorkspaceId,
  clientId: string,
  admit: (workspaceRuntimeId: string) => Promise<T>,
): Promise<T> {
  const state = workspaceRuntimeState(userId, workspaceId)
  const previousWorkspaceRuntimeId = state.currentWorkspaceRuntimeId
  const previousGeneration = state.members.get(clientId)
  const lease = acquireWorkspaceRuntimeMembership(userId, workspaceId, clientId)
  try {
    const result = await admit(lease.workspaceRuntimeId)
    emitWorkspaceRuntimeMembershipAcquired({ userId, clientId })
    return result
  } catch (error) {
    rollbackWorkspaceRuntimeAdmission({
      userId,
      clientId,
      state,
      lease,
      previousWorkspaceRuntimeId,
      previousGeneration,
    })
    throw error
  }
}

function rollbackWorkspaceRuntimeAdmission(input: {
  userId: string
  clientId: string
  state: WorkspaceRuntimeState
  lease: WorkspaceRuntimeMembershipLeaseEntry
  previousWorkspaceRuntimeId: string | null
  previousGeneration: number | undefined
}): void {
  const { userId, clientId, state, lease, previousWorkspaceRuntimeId, previousGeneration } = input
  if (
    workspaceRuntimesByUser.get(userId)?.get(lease.workspaceId) !== state ||
    state.currentWorkspaceRuntimeId !== lease.workspaceRuntimeId ||
    state.members.get(clientId) !== lease.generation
  ) {
    return
  }
  if (previousWorkspaceRuntimeId === lease.workspaceRuntimeId && previousGeneration !== undefined) {
    state.members.set(clientId, previousGeneration)
    return
  }
  state.members.delete(clientId)
  if (state.members.size > 0 || state.activeWorkspaceLifecycleOperations > 0) return
  const workspaceRuntimeId = stopWorkspaceRuntimeEpoch(state)
  if (!workspaceRuntimeId) return
  emitWorkspaceRuntimeClosed({ userId, workspaceId: lease.workspaceId, workspaceRuntimeId })
}

export function acquireWorkspaceRuntimeLease(
  userId: string,
  workspaceId: WorkspaceId,
  clientId: string,
): WorkspaceRuntimeMembershipLeaseEntry {
  const lease = acquireWorkspaceRuntimeMembership(userId, workspaceId, clientId)
  emitWorkspaceRuntimeMembershipAcquired({ userId, clientId })
  return lease
}

function acquireWorkspaceRuntimeMembership(
  userId: string,
  workspaceId: WorkspaceId,
  clientId: string,
): WorkspaceRuntimeMembershipLeaseEntry {
  if (!clientId) throw new Error('workspace runtime acquire requires clientId')
  const state = workspaceRuntimeState(userId, workspaceId)
  const workspaceRuntimeId = state.currentWorkspaceRuntimeId ?? startWorkspaceRuntimeEpoch(state)
  state.nextMembershipGeneration += 1
  state.members.set(clientId, state.nextMembershipGeneration)
  return { workspaceId, workspaceRuntimeId, generation: state.nextMembershipGeneration }
}

export function releaseWorkspaceRuntime(
  userId: string,
  workspaceId: WorkspaceId,
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
  emitWorkspaceRuntimeMembershipReleasedFor(userId, clientId, lease.workspaceId, lease.workspaceRuntimeId)
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
    emitWorkspaceRuntimeMembershipReleasedFor(
      lease.userId,
      lease.clientId,
      entry.workspaceId,
      entry.workspaceRuntimeId,
    )
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
        remoteLifecycle: isRemoteWorkspaceId(workspaceId) ? state.remoteLifecycle : null,
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
  workspaceIds: readonly WorkspaceId[],
): WorkspaceRuntimeEntry[] {
  admitWorkspaceRuntimeMembershipDeclaration(clientId, workspaceIds)
  const desired = new Set(workspaceIds)
  const states = workspaceRuntimesByUser.get(userId)
  const closed: WorkspaceRuntimeClosedEvent[] = []
  if (states) {
    for (const [workspaceId, state] of states) {
      if (desired.has(state.workspaceId)) continue
      const workspaceRuntimeId = state.currentWorkspaceRuntimeId
      if (!workspaceRuntimeId || !state.members.delete(clientId)) continue
      emitWorkspaceRuntimeMembershipReleasedFor(userId, clientId, state.workspaceId, workspaceRuntimeId)
      if (state.members.size > 0) continue
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

function admitWorkspaceRuntimeMembershipDeclaration(
  clientId: string,
  workspaceIds: readonly WorkspaceId[],
): void {
  if (!isOpaqueId(clientId)) throw new Error('workspace runtime reconcile requires a valid clientId')
  if (workspaceIds.length > 100) throw new Error('workspace runtime reconcile accepts at most 100 workspace ids')
}

export function isCurrentWorkspaceRuntime(
  userId: string,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): boolean {
  return workspaceRuntimesByUser.get(userId)?.get(workspaceId)?.currentWorkspaceRuntimeId === workspaceRuntimeId
}

export function workspaceRuntimeHasGitCapability(
  userId: string,
  workspaceId: WorkspaceId,
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
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): WorkspaceProbeState | null {
  const state = workspaceRuntimesByUser.get(userId)?.get(workspaceId)
  return state?.currentWorkspaceRuntimeId === workspaceRuntimeId ? exposedWorkspaceProbe(state) : null
}

export function commitWorkspaceProbeState(input: {
  userId: string
  workspaceId: WorkspaceId
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
  workspaceId: WorkspaceId
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
  workspaceId: WorkspaceId
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
  workspaceId: WorkspaceId
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
  input: { userId: string; workspaceId: WorkspaceId; workspaceRuntimeId: string },
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
  input: { userId: string; workspaceId: WorkspaceId; workspaceRuntimeId: string },
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
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  clientId: string,
): boolean {
  const state = workspaceRuntimesByUser.get(userId)?.get(workspaceId)
  return state?.currentWorkspaceRuntimeId === workspaceRuntimeId && state.members.has(clientId)
}

export function workspaceRuntimeClientHasMemberships(userId: string, clientId: string): boolean {
  return [...(workspaceRuntimesByUser.get(userId)?.values() ?? [])].some((state) => state.members.has(clientId))
}

export async function failRemoteWorkspaceLifecycle(input: {
  userId: string
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  reason: RemoteWorkspaceFailureReason
  target?: RemoteWorkspaceTarget
  onTransition?: (lifecycle: RemoteWorkspaceRuntimeLifecycle) => void
}): Promise<RemoteWorkspaceLifecycleFailResult> {
  if (!isRemoteWorkspaceId(input.workspaceId)) return { kind: 'not-remote' }
  const result = await runSerializedWorkspaceLifecycleOperation(input, async (state) => {
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
    notifyRemoteLifecycleTransition(input.onTransition ?? (() => {}), state.remoteLifecycle, input.workspaceId)
    return {
      kind: 'settled',
      name: workspaceRuntimeDisplayName(state, input.workspaceId),
      lifecycle: state.remoteLifecycle,
    } satisfies RemoteWorkspaceLifecycleFailResult
  })
  return result ?? { kind: 'stale-runtime' }
}

export async function runRemoteWorkspaceLifecycle(
  userId: string,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  resolve: (signal: AbortSignal) => Promise<RemoteWorkspaceConnectionResult>,
  onTransition: (lifecycle: RemoteWorkspaceRuntimeLifecycle) => void = () => {},
  mode: 'restart' | 'ensure' = 'restart',
  terminalCommitPlan: (result: RemoteWorkspaceConnectionResult) => RemoteWorkspaceTerminalCommitPlan = () => ({}),
): Promise<RemoteWorkspaceLifecycleRunResult> {
  const state = workspaceRuntimesByUser.get(userId)?.get(workspaceId)
  if (!state || state.currentWorkspaceRuntimeId !== workspaceRuntimeId) return { kind: 'stale-runtime' }
  const admission = await runSerializedWorkspaceLifecycleOperation(
    { userId, workspaceId, workspaceRuntimeId },
    async (current) => {
      if (mode === 'ensure') {
        if (current.remoteLifecycle.kind === 'connecting' && current.remoteAttemptPromise) {
          return { kind: 'attempt', attempt: current.remoteAttemptPromise } as const
        }
        if (current.remoteLifecycle.kind === 'ready') {
          return {
            kind: 'result',
            result: settledRemoteWorkspaceLifecycleResult(
              current,
              workspaceId,
              workspaceRuntimeDisplayName(current, workspaceId),
            ),
          } as const
        }
      }
      current.remoteAttemptController?.abort()
      const previousLifecycle = current.remoteLifecycle
      const controller = new AbortController()
      const attemptId = current.remoteLifecycle.attemptId + 1
      current.remoteAttemptController = controller
      current.remoteLifecycle = { kind: 'connecting', attemptId }
      notifyRemoteLifecycleTransition(onTransition, current.remoteLifecycle, workspaceId)
      const attempt = settleRemoteWorkspaceLifecycleAttempt(
        current,
        userId,
        workspaceId,
        workspaceRuntimeId,
        controller,
        attemptId,
        resolve,
        onTransition,
        terminalCommitPlan,
        previousLifecycle,
      )
      current.remoteAttemptPromise = attempt
      return { kind: 'attempt', attempt } as const
    },
  )
  if (!admission) return { kind: 'stale-runtime' }
  if (admission.kind === 'result') return admission.result
  const result = await admission.attempt
  if (mode === 'ensure' && result.kind === 'superseded') {
    return await runRemoteWorkspaceLifecycle(
      userId,
      workspaceId,
      workspaceRuntimeId,
      resolve,
      onTransition,
      mode,
      terminalCommitPlan,
    )
  }
  return result
}

async function settleRemoteWorkspaceLifecycleAttempt(
  state: WorkspaceRuntimeState,
  userId: string,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  controller: AbortController,
  attemptId: number,
  resolve: (signal: AbortSignal) => Promise<RemoteWorkspaceConnectionResult>,
  onTransition: (lifecycle: RemoteWorkspaceRuntimeLifecycle) => void,
  terminalCommitPlan: (result: RemoteWorkspaceConnectionResult) => RemoteWorkspaceTerminalCommitPlan,
  previousLifecycle: RemoteWorkspaceRuntimeLifecycle,
): Promise<RemoteWorkspaceLifecycleRunResult> {
  let result: RemoteWorkspaceConnectionResult
  try {
    result = await resolve(controller.signal)
  } catch (error) {
    if (
      state.currentWorkspaceRuntimeId !== workspaceRuntimeId ||
      state.remoteAttemptController !== controller ||
      state.remoteLifecycle.attemptId !== attemptId
    ) {
      return supersededRemoteWorkspaceLifecycleResult(state, workspaceRuntimeId)
    }
    result = {
      kind: 'failed',
      name: workspaceId,
      lifecycle: { kind: 'failed', reason: 'unknown' },
    }
  }

  try {
    const committed = await commitRemoteWorkspaceLifecycleTerminal({
      state,
      userId,
      workspaceId,
      workspaceRuntimeId,
      controller,
      attemptId,
      result,
      plan: terminalCommitPlan(result),
      previousLifecycle,
      onTransition,
    })
    if (!committed) return supersededRemoteWorkspaceLifecycleResult(state, workspaceRuntimeId)
    return committed
  } finally {
    if (state.remoteAttemptController === controller) {
      state.remoteAttemptController = null
      state.remoteAttemptPromise = null
    }
  }
}

async function commitRemoteWorkspaceLifecycleTerminal(input: {
  state: WorkspaceRuntimeState
  userId: string
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  controller: AbortController
  attemptId: number
  result: RemoteWorkspaceConnectionResult
  plan: RemoteWorkspaceTerminalCommitPlan
  previousLifecycle: RemoteWorkspaceRuntimeLifecycle
  onTransition: (lifecycle: RemoteWorkspaceRuntimeLifecycle) => void
}): Promise<Extract<RemoteWorkspaceLifecycleRunResult, { kind: 'settled' }> | null> {
  return await runSerializedWorkspaceLifecycleOperation(input, async (state) => {
    if (!remoteAttemptMayCommit(input)) return null
    const transition = workspaceProbeTransitionForRemoteCommit(state.workspaceProbe, input.plan)
    if (transition) {
      state.workspaceProbe = transition.after
      state.pendingWorkspaceProbeTransition = transition
    }
    try {
      if (transition) await input.plan.workspaceProbe?.beforeCommit?.(transition)
    } catch (error) {
      if (transition) {
        state.workspaceProbe = transition.before
        state.pendingWorkspaceProbeTransition = null
      }
      if (remoteAttemptMayCommit(input)) {
        state.remoteLifecycle = input.previousLifecycle
        state.remoteAttemptController = null
        state.remoteAttemptPromise = null
        notifyRemoteLifecycleTransition(input.onTransition, state.remoteLifecycle, input.workspaceId)
      }
      throw error
    }
    if (!remoteAttemptMayCommit(input)) {
      if (transition) {
        state.workspaceProbe = transition.before
        state.pendingWorkspaceProbeTransition = null
      }
      return null
    }
    state.remoteLifecycle = terminalRemoteLifecycle(input.result, input.attemptId)
    state.remoteAttemptController = null
    state.remoteAttemptPromise = null
    state.pendingWorkspaceProbeTransition = null
    const settled = settledRemoteWorkspaceLifecycleResult(state, input.workspaceId, input.result.name)
    notifyRemoteLifecycleTransition(input.onTransition, settled.lifecycle, input.workspaceId)
    return settled
  })
}

function workspaceProbeTransitionForRemoteCommit(
  current: WorkspaceProbeState,
  plan: RemoteWorkspaceTerminalCommitPlan,
): { before: WorkspaceProbeState; after: WorkspaceSettledProbeState } | null {
  const workspaceProbe = plan.workspaceProbe
  if (!workspaceProbe) return null
  if (workspaceProbe.mode === 'initial-only' && current.status !== 'probing') return null
  if (
    workspaceProbe.mode === 'refresh' &&
    current.status !== 'probing' &&
    !workspaceRefreshMayCommit(workspaceProbe.probe)
  ) {
    return null
  }
  return { before: current, after: workspaceProbe.probe }
}

function remoteAttemptMayCommit(input: {
  state: WorkspaceRuntimeState
  workspaceRuntimeId: string
  controller: AbortController
  attemptId: number
}): boolean {
  return (
    input.state.currentWorkspaceRuntimeId === input.workspaceRuntimeId &&
    input.state.remoteAttemptController === input.controller &&
    input.state.remoteLifecycle.kind === 'connecting' &&
    input.state.remoteLifecycle.attemptId === input.attemptId
  )
}

function terminalRemoteLifecycle(result: RemoteWorkspaceConnectionResult, attemptId: number): TerminalRemoteLifecycle {
  return result.kind === 'ready'
    ? { kind: 'ready', attemptId, target: result.lifecycle.target }
    : {
        kind: 'failed',
        attemptId,
        reason: result.lifecycle.reason,
        ...(result.lifecycle.target ? { target: result.lifecycle.target } : {}),
      }
}

function settledRemoteWorkspaceLifecycleResult(
  state: WorkspaceRuntimeState,
  workspaceId: WorkspaceId,
  name: string,
): Extract<RemoteWorkspaceLifecycleRunResult, { kind: 'settled' }> {
  if (state.remoteLifecycle.kind !== 'ready' && state.remoteLifecycle.kind !== 'failed') {
    throw new Error('remote workspace lifecycle must be terminal before it settles')
  }
  return { kind: 'settled', name, lifecycle: state.remoteLifecycle }
}

function workspaceRuntimeDisplayName(state: WorkspaceRuntimeState, workspaceId: WorkspaceId): string {
  if (state.workspaceProbe.status === 'ready') return state.workspaceProbe.name
  return remoteLifecycleTarget(state.remoteLifecycle)?.displayName ?? workspaceId
}

function remoteLifecycleTarget(lifecycle: RemoteWorkspaceRuntimeLifecycle): RemoteWorkspaceTarget | null {
  return lifecycle.kind === 'ready' || lifecycle.kind === 'failed' ? (lifecycle.target ?? null) : null
}

function supersededRemoteWorkspaceLifecycleResult(
  state: WorkspaceRuntimeState,
  workspaceRuntimeId: string,
): RemoteWorkspaceLifecycleRunResult {
  return state.currentWorkspaceRuntimeId === workspaceRuntimeId ? { kind: 'superseded' } : { kind: 'stale-runtime' }
}

function notifyRemoteLifecycleTransition(
  listener: (lifecycle: RemoteWorkspaceRuntimeLifecycle) => void,
  lifecycle: RemoteWorkspaceRuntimeLifecycle,
  workspaceId: WorkspaceId,
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

export function onWorkspaceRuntimeMembershipReleased(
  listener: (event: WorkspaceRuntimeMembershipReleasedEvent) => void,
): () => void {
  workspaceRuntimeMembershipReleasedListeners.add(listener)
  return () => {
    workspaceRuntimeMembershipReleasedListeners.delete(listener)
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

function emitWorkspaceRuntimeMembershipReleased(event: WorkspaceRuntimeMembershipReleasedEvent): void {
  for (const listener of workspaceRuntimeMembershipReleasedListeners) {
    try {
      listener(event)
    } catch (err) {
      workspaceRuntimeLogger.warn(
        { err, userId: event.userId, clientId: event.clientId, workspaceId: event.workspaceId },
        'membership release listener failed',
      )
    }
  }
}

function emitWorkspaceRuntimeMembershipReleasedFor(
  userId: string,
  clientId: string,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): void {
  const hasRemainingMemberships = workspaceRuntimeClientHasMemberships(userId, clientId)
  emitWorkspaceRuntimeMembershipReleased({
    userId,
    clientId,
    workspaceId,
    workspaceRuntimeId,
    hasRemainingMemberships,
  })
}
