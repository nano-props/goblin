import { createOpaqueId } from '#/shared/opaque-id.ts'
import { serverLogger } from '#/server/logger.ts'

interface RepoRuntimeState {
  currentRepoRuntimeId: string | null
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
  const created: RepoRuntimeState = { currentRepoRuntimeId: null }
  byRepo.set(repoRoot, created)
  return created
}

export function openRepoRuntime(userId: string, repoRoot: string): string {
  if (!repoRoot) throw new Error('repo runtime open requires repoRoot')
  const state = repoRuntimeState(userId, repoRoot)
  const previousRepoRuntimeId = state.currentRepoRuntimeId
  const repoRuntimeId = createOpaqueId('repo-runtime')
  state.currentRepoRuntimeId = repoRuntimeId
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
  state.currentRepoRuntimeId = null
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
