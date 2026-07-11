import { createOpaqueId } from '#/shared/opaque-id.ts'
import { serverLogger } from '#/server/logger.ts'
import type {
  RemoteRepoConnectionResult,
  RemoteRepoRuntimeLifecycle,
} from '#/shared/remote-repo.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'

interface RepoRuntimeState {
  currentRepoRuntimeId: string | null
  remoteLifecycle: RemoteRepoRuntimeLifecycle
  remoteAttemptController: AbortController | null
}

export interface RepoRuntimeClosedEvent {
  userId: string
  repoRoot: string
  repoRuntimeId: string
}

export interface RepoRuntimeEntry {
  repoRoot: string
  repoRuntimeId: string
  remoteLifecycle: RemoteRepoRuntimeLifecycle | null
}

type TerminalRemoteLifecycle = Extract<RemoteRepoRuntimeLifecycle, { kind: 'ready' | 'failed' }>

export type RepoRemoteLifecycleRunResult =
  | { kind: 'settled'; lifecycle: TerminalRemoteLifecycle }
  | { kind: 'superseded' }
  | { kind: 'stale-runtime' }

const repoRuntimesByUser = new Map<string, Map<string, RepoRuntimeState>>()
const repoRuntimeClosedListeners = new Set<(event: RepoRuntimeClosedEvent) => void>()
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
    remoteLifecycle: { kind: 'idle', attemptId: 0 },
    remoteAttemptController: null,
  }
  byRepo.set(repoRoot, created)
  return created
}

export function openRepoRuntime(userId: string, repoRoot: string): string {
  if (!repoRoot) throw new Error('repo runtime open requires repoRoot')
  const state = repoRuntimeState(userId, repoRoot)
  const previousRepoRuntimeId = stopRepoRuntimeEpoch(state)
  const repoRuntimeId = startRepoRuntimeEpoch(state)
  if (previousRepoRuntimeId) emitRepoRuntimeClosed({ userId, repoRoot, repoRuntimeId: previousRepoRuntimeId })
  return repoRuntimeId
}

export function getOrOpenRepoRuntime(userId: string, repoRoot: string): string {
  if (!repoRoot) throw new Error('repo runtime open requires repoRoot')
  const state = repoRuntimeState(userId, repoRoot)
  if (state.currentRepoRuntimeId) return state.currentRepoRuntimeId
  return startRepoRuntimeEpoch(state)
}

export function closeRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): boolean {
  const state = repoRuntimesByUser.get(userId)?.get(repoRoot)
  if (!state) return false
  if (state.currentRepoRuntimeId !== repoRuntimeId) return false
  stopRepoRuntimeEpoch(state)
  emitRepoRuntimeClosed({ userId, repoRoot, repoRuntimeId })
  return true
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

export function isCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): boolean {
  return repoRuntimesByUser.get(userId)?.get(repoRoot)?.currentRepoRuntimeId === repoRuntimeId
}

export async function runRepoRemoteLifecycle(
  userId: string,
  repoRoot: string,
  repoRuntimeId: string,
  resolve: (signal: AbortSignal) => Promise<RemoteRepoConnectionResult>,
  onTransition: (lifecycle: RemoteRepoRuntimeLifecycle) => void = () => {},
): Promise<RepoRemoteLifecycleRunResult> {
  const state = repoRuntimesByUser.get(userId)?.get(repoRoot)
  if (!state || state.currentRepoRuntimeId !== repoRuntimeId) return { kind: 'stale-runtime' }

  state.remoteAttemptController?.abort()
  const controller = new AbortController()
  const attemptId = state.remoteLifecycle.attemptId + 1
  state.remoteAttemptController = controller
  state.remoteLifecycle = { kind: 'connecting', attemptId }
  notifyRemoteLifecycleTransition(onTransition, state.remoteLifecycle, repoRoot)

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
    notifyRemoteLifecycleTransition(onTransition, state.remoteLifecycle, repoRoot)
    return { kind: 'settled', lifecycle: state.remoteLifecycle }
  } catch (error) {
    if (
      state.currentRepoRuntimeId !== repoRuntimeId ||
      state.remoteAttemptController !== controller ||
      state.remoteLifecycle.attemptId !== attemptId
    ) {
      return supersededRemoteLifecycleResult(state, repoRuntimeId)
    }
    state.remoteLifecycle = { kind: 'failed', attemptId, reason: 'unknown' }
    notifyRemoteLifecycleTransition(onTransition, state.remoteLifecycle, repoRoot)
    return { kind: 'settled', lifecycle: state.remoteLifecycle }
  } finally {
    if (state.remoteAttemptController === controller) state.remoteAttemptController = null
  }
}

function supersededRemoteLifecycleResult(
  state: RepoRuntimeState,
  repoRuntimeId: string,
): RepoRemoteLifecycleRunResult {
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
    repoRuntimeLogger.warn({ err, repoRoot, attemptId: lifecycle.attemptId }, 'remote lifecycle transition listener failed')
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
  if (state.currentRepoRuntimeId || state.remoteAttemptController) {
    throw new Error('repo runtime epoch must stop before it starts')
  }
  const repoRuntimeId = createOpaqueId('repo-runtime')
  state.currentRepoRuntimeId = repoRuntimeId
  state.remoteLifecycle = { kind: 'idle', attemptId: 0 }
  return repoRuntimeId
}

function stopRepoRuntimeEpoch(state: RepoRuntimeState): string | null {
  const repoRuntimeId = state.currentRepoRuntimeId
  state.remoteAttemptController?.abort()
  state.remoteAttemptController = null
  state.currentRepoRuntimeId = null
  return repoRuntimeId
}

export function onRepoRuntimeClosed(listener: (event: RepoRuntimeClosedEvent) => void): () => void {
  repoRuntimeClosedListeners.add(listener)
  return () => {
    repoRuntimeClosedListeners.delete(listener)
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
