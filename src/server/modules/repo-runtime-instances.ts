import { createOpaqueId } from '#/shared/opaque-id.ts'
import { serverLogger } from '#/server/logger.ts'

interface RepoRuntimeInstanceState {
  currentInstanceId: string | null
}

export interface RepoRuntimeInstanceClosedEvent {
  userId: string
  repoRoot: string
  repoInstanceId: string
}

const runtimeInstancesByUser = new Map<string, Map<string, RepoRuntimeInstanceState>>()
const repoRuntimeInstanceClosedListeners = new Set<(event: RepoRuntimeInstanceClosedEvent) => void>()
const repoRuntimeInstanceLogger = serverLogger.child({ tag: 'repo-runtime-instance' })

function repoRuntimeStateByUser(userId: string): Map<string, RepoRuntimeInstanceState> {
  let states = runtimeInstancesByUser.get(userId)
  if (states) return states
  states = new Map<string, RepoRuntimeInstanceState>()
  runtimeInstancesByUser.set(userId, states)
  return states
}

function repoRuntimeState(userId: string, repoRoot: string): RepoRuntimeInstanceState {
  const byRepo = repoRuntimeStateByUser(userId)
  const existing = byRepo.get(repoRoot)
  if (existing) return existing
  const created: RepoRuntimeInstanceState = { currentInstanceId: null }
  byRepo.set(repoRoot, created)
  return created
}

export function openRepoRuntimeInstance(userId: string, repoRoot: string): string {
  if (!repoRoot) throw new Error('repo runtime open requires repoRoot')
  const state = repoRuntimeState(userId, repoRoot)
  const previousInstanceId = state.currentInstanceId
  const instanceId = createOpaqueId('repo-instance')
  state.currentInstanceId = instanceId
  if (previousInstanceId) emitRepoRuntimeInstanceClosed({ userId, repoRoot, repoInstanceId: previousInstanceId })
  return instanceId
}

export function getOrOpenRepoRuntimeInstance(userId: string, repoRoot: string): string {
  if (!repoRoot) throw new Error('repo runtime open requires repoRoot')
  const state = repoRuntimeState(userId, repoRoot)
  if (state.currentInstanceId) return state.currentInstanceId
  const instanceId = createOpaqueId('repo-instance')
  state.currentInstanceId = instanceId
  return instanceId
}

export function closeRepoRuntimeInstance(userId: string, repoRoot: string, repoInstanceId: string): boolean {
  const state = runtimeInstancesByUser.get(userId)?.get(repoRoot)
  if (!state) return false
  if (state.currentInstanceId !== repoInstanceId) return false
  state.currentInstanceId = null
  emitRepoRuntimeInstanceClosed({ userId, repoRoot, repoInstanceId })
  return true
}

export function isCurrentRepoRuntimeInstance(userId: string, repoRoot: string, repoInstanceId: string): boolean {
  return runtimeInstancesByUser.get(userId)?.get(repoRoot)?.currentInstanceId === repoInstanceId
}

export function clearRepoRuntimeInstancesForUser(userId: string): void {
  const states = runtimeInstancesByUser.get(userId)
  if (states) {
    for (const [repoRoot, state] of states) {
      if (state.currentInstanceId) {
        emitRepoRuntimeInstanceClosed({ userId, repoRoot, repoInstanceId: state.currentInstanceId })
      }
    }
  }
  runtimeInstancesByUser.delete(userId)
}

export function onRepoRuntimeInstanceClosed(listener: (event: RepoRuntimeInstanceClosedEvent) => void): () => void {
  repoRuntimeInstanceClosedListeners.add(listener)
  return () => {
    repoRuntimeInstanceClosedListeners.delete(listener)
  }
}

function emitRepoRuntimeInstanceClosed(event: RepoRuntimeInstanceClosedEvent): void {
  for (const listener of repoRuntimeInstanceClosedListeners) {
    try {
      listener(event)
    } catch (err) {
      repoRuntimeInstanceLogger.warn({ err, repoRoot: event.repoRoot }, 'repo runtime close listener failed')
    }
  }
}
