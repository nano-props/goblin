import { createOpaqueId } from '#/shared/opaque-id.ts'
import { serverLogger } from '#/server/logger.ts'
import type {
  RemoteRepoConnectionResult,
  RemoteRepoRuntimeLifecycle,
} from '#/shared/remote-repo.ts'

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
}

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
  const previousRepoRuntimeId = state.currentRepoRuntimeId
  const repoRuntimeId = createOpaqueId('repo-runtime')
  state.remoteAttemptController?.abort()
  state.currentRepoRuntimeId = repoRuntimeId
  state.remoteLifecycle = { kind: 'idle', attemptId: 0 }
  state.remoteAttemptController = null
  if (previousRepoRuntimeId) emitRepoRuntimeClosed({ userId, repoRoot, repoRuntimeId: previousRepoRuntimeId })
  return repoRuntimeId
}

export function getOrOpenRepoRuntime(userId: string, repoRoot: string): string {
  if (!repoRoot) throw new Error('repo runtime open requires repoRoot')
  const state = repoRuntimeState(userId, repoRoot)
  if (state.currentRepoRuntimeId) return state.currentRepoRuntimeId
  const repoRuntimeId = createOpaqueId('repo-runtime')
  state.currentRepoRuntimeId = repoRuntimeId
  return repoRuntimeId
}

export function closeRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): boolean {
  const state = repoRuntimesByUser.get(userId)?.get(repoRoot)
  if (!state) return false
  if (state.currentRepoRuntimeId !== repoRuntimeId) return false
  state.remoteAttemptController?.abort()
  state.currentRepoRuntimeId = null
  state.remoteAttemptController = null
  emitRepoRuntimeClosed({ userId, repoRoot, repoRuntimeId })
  return true
}

export function listRepoRuntimes(userId: string): RepoRuntimeEntry[] {
  const states = repoRuntimesByUser.get(userId)
  if (!states) return []
  const runtimes: RepoRuntimeEntry[] = []
  for (const [repoRoot, state] of states) {
    if (state.currentRepoRuntimeId) runtimes.push({ repoRoot, repoRuntimeId: state.currentRepoRuntimeId })
  }
  return runtimes
}

export function isCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): boolean {
  return repoRuntimesByUser.get(userId)?.get(repoRoot)?.currentRepoRuntimeId === repoRuntimeId
}

export class StaleRepoRuntimeError extends Error {
  constructor() {
    super('stale repo runtime')
    this.name = 'StaleRepoRuntimeError'
  }
}

export function getRepoRemoteLifecycle(
  userId: string,
  repoRoot: string,
  repoRuntimeId: string,
): RemoteRepoRuntimeLifecycle {
  const state = repoRuntimesByUser.get(userId)?.get(repoRoot)
  if (!state || state.currentRepoRuntimeId !== repoRuntimeId) throw new StaleRepoRuntimeError()
  return state.remoteLifecycle
}

export async function runRepoRemoteLifecycle(
  userId: string,
  repoRoot: string,
  repoRuntimeId: string,
  resolve: (signal: AbortSignal) => Promise<RemoteRepoConnectionResult>,
): Promise<RemoteRepoRuntimeLifecycle> {
  const state = repoRuntimesByUser.get(userId)?.get(repoRoot)
  if (!state || state.currentRepoRuntimeId !== repoRuntimeId) throw new StaleRepoRuntimeError()

  state.remoteAttemptController?.abort()
  const controller = new AbortController()
  const attemptId = state.remoteLifecycle.attemptId + 1
  state.remoteAttemptController = controller
  state.remoteLifecycle = { kind: 'connecting', attemptId }

  try {
    const result = await resolve(controller.signal)
    if (
      state.currentRepoRuntimeId !== repoRuntimeId ||
      state.remoteAttemptController !== controller ||
      state.remoteLifecycle.attemptId !== attemptId
    ) {
      throw new StaleRepoRuntimeError()
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
    return state.remoteLifecycle
  } catch (error) {
    if (
      state.currentRepoRuntimeId !== repoRuntimeId ||
      state.remoteAttemptController !== controller ||
      state.remoteLifecycle.attemptId !== attemptId
    ) {
      throw new StaleRepoRuntimeError()
    }
    state.remoteLifecycle = { kind: 'failed', attemptId, reason: 'unknown' }
    return state.remoteLifecycle
  } finally {
    if (state.remoteAttemptController === controller) state.remoteAttemptController = null
  }
}

export function clearRepoRuntimesForUser(userId: string): void {
  const states = repoRuntimesByUser.get(userId)
  if (states) {
    for (const [repoRoot, state] of states) {
      if (state.currentRepoRuntimeId) {
        const repoRuntimeId = state.currentRepoRuntimeId
        state.currentRepoRuntimeId = null
        emitRepoRuntimeClosed({ userId, repoRoot, repoRuntimeId })
      }
    }
  }
  repoRuntimesByUser.delete(userId)
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
