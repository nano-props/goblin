import {
  idleOperation,
  operationBusy,
  queueOperation,
  settleOperation,
  startOperation,
  type RepoOperationKey,
  type RepoOperationReason,
  type RepoOperationState,
  type RepoOperationTarget,
} from '#/web/stores/repos/operations.ts'
export type RepoTaskLane = 'network' | 'read' | 'write' | 'lifecycle'
export type { RepoOperationKey, RepoOperationTarget as RepoRuntimeOperationTarget }

interface QueuedRepoTask<T> {
  task: (signal: AbortSignal) => Promise<T>
  priority: number
  replaceKey?: string
  ctrl: AbortController
  timeout?: ReturnType<typeof globalThis.setTimeout>
  onStart?: (wasQueued: boolean) => void
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

interface RepoLaneOptions {
  priority?: number
  // Includes the lane namespace because runRepoOperation builds it from lane + operationKey.
  replaceQueuedKey?: string
  queuedTimeoutMs?: number
  queuedTimeoutMessage?: string
  onQueued?: () => void
  onStart?: (wasQueued: boolean) => void
}

function rejectQueuedTask(task: QueuedRepoTask<unknown>, message: string): void {
  queueMicrotask(() => {
    task.reject(new Error(message))
  })
}

class RepoLane {
  private active = 0
  private activeControllers = new Set<AbortController>()
  // Index of active tasks by their `replaceKey`, so a new
  // latest-wins submission can abort the previous run's signal
  // in addition to draining the queue. The orchestrator relies
  // on this to free the lane's concurrency slot immediately on
  // supersede — without it, a long-running lifecycle probe (up
  // to 20s) would block a retry that the user explicitly
  // requested, because the new run is queued behind the old
  // active one (concurrency=1).
  private activeByReplaceKey = new Map<string, AbortController>()
  private queued: Array<QueuedRepoTask<unknown>> = []

  private readonly concurrency: number
  constructor(concurrency: number) {
    this.concurrency = concurrency
  }

  add<T>(task: (signal: AbortSignal) => Promise<T>, options?: RepoLaneOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const queuedTask: QueuedRepoTask<T> = {
        task,
        priority: options?.priority ?? 0,
        replaceKey: options?.replaceQueuedKey,
        ctrl: new AbortController(),
        onStart: options?.onStart,
        resolve,
        reject,
      }
      if (queuedTask.replaceKey) {
        this.cancelQueued(queuedTask.replaceKey)
        // Active-cancel must run BEFORE the new task is registered
        // — otherwise the new run's own controller would be the
        // one we find in the map and we'd abort ourselves.
        this.cancelActiveByKey(queuedTask.replaceKey)
      }
      if (this.active < this.concurrency) this.start(queuedTask, false)
      else {
        options?.onQueued?.()
        if (options?.queuedTimeoutMs !== undefined) {
          queuedTask.timeout = globalThis.setTimeout(() => {
            if (this.removeQueued(queuedTask as QueuedRepoTask<unknown>)) {
              queuedTask.ctrl.abort(options.queuedTimeoutMessage)
              rejectQueuedTask(queuedTask as QueuedRepoTask<unknown>, options.queuedTimeoutMessage ?? 'cancelled')
            }
          }, options.queuedTimeoutMs)
        }
        this.enqueue(queuedTask as QueuedRepoTask<unknown>)
      }
    })
  }

  cancelAll(): void {
    for (const ctrl of this.activeControllers) ctrl.abort()
    const queued = this.queued
    this.queued = []
    for (const task of queued) {
      if (task.timeout) globalThis.clearTimeout(task.timeout)
      task.ctrl.abort()
      rejectQueuedTask(task, 'cancelled')
    }
    // Clear the active-key index — every active task is being
    // canceled, so the index is stale by definition. `start`'s
    // `.finally()` will see the empty map and skip the index
    // cleanup, which is fine (the map is already empty).
    this.activeByReplaceKey.clear()
  }

  private start<T>(queuedTask: QueuedRepoTask<T>, wasQueued: boolean): void {
    if (queuedTask.timeout) globalThis.clearTimeout(queuedTask.timeout)
    this.active += 1
    this.activeControllers.add(queuedTask.ctrl)
    if (queuedTask.replaceKey) this.activeByReplaceKey.set(queuedTask.replaceKey, queuedTask.ctrl)
    let work: Promise<T>
    try {
      queuedTask.onStart?.(wasQueued)
      work = queuedTask.task(queuedTask.ctrl.signal)
    } catch (err) {
      this.activeControllers.delete(queuedTask.ctrl)
      if (queuedTask.replaceKey && this.activeByReplaceKey.get(queuedTask.replaceKey) === queuedTask.ctrl) {
        this.activeByReplaceKey.delete(queuedTask.replaceKey)
      }
      this.active -= 1
      queuedTask.reject(err)
      this.drain()
      return
    }
    work.then(queuedTask.resolve, queuedTask.reject).finally(() => {
      this.activeControllers.delete(queuedTask.ctrl)
      if (queuedTask.replaceKey && this.activeByReplaceKey.get(queuedTask.replaceKey) === queuedTask.ctrl) {
        this.activeByReplaceKey.delete(queuedTask.replaceKey)
      }
      this.active -= 1
      this.drain()
    })
  }

  private enqueue(task: QueuedRepoTask<unknown>): void {
    const index = this.queued.findIndex((queued) => queued.priority < task.priority)
    this.queued.splice(index === -1 ? this.queued.length : index, 0, task)
  }

  cancelQueued(replaceKey: string): boolean {
    let cancelled = false
    const keep: Array<QueuedRepoTask<unknown>> = []
    for (const task of this.queued) {
      if (task.replaceKey !== replaceKey) {
        keep.push(task)
        continue
      }
      cancelled = true
      if (task.timeout) globalThis.clearTimeout(task.timeout)
      task.ctrl.abort()
      rejectQueuedTask(task, 'cancelled')
    }
    this.queued = keep
    return cancelled
  }

  /**
   * Abort the active task for a given `replaceKey` if one is in
   * flight. Returns whether an active task was found. The aborted
   * task's promise rejects with an `AbortError`, its `.finally()`
   * cleans up the index, and the next queued task (if any) is
   * drained into the freed concurrency slot.
   */
  private cancelActiveByKey(replaceKey: string): boolean {
    const ctrl = this.activeByReplaceKey.get(replaceKey)
    if (!ctrl) return false
    ctrl.abort()
    return true
  }

  private removeQueued(task: QueuedRepoTask<unknown>): boolean {
    const index = this.queued.indexOf(task)
    if (index === -1) return false
    this.queued.splice(index, 1)
    if (task.timeout) globalThis.clearTimeout(task.timeout)
    return true
  }

  private drain(): void {
    while (this.active < this.concurrency) {
      const next = this.queued.shift()
      if (!next) return
      this.start(next, true)
    }
  }
}

interface RepoRuntime {
  nextOperationId: number
  queues: Record<RepoTaskLane, RepoLane>
  operations: Record<string, RepoOperationState | undefined>
}

const runtimes = new Map<string, RepoRuntime>()
const operationIdleWaiters = new Map<string, Set<() => void>>()

function createRuntime(): RepoRuntime {
  return {
    nextOperationId: 1,
    queues: {
      network: new RepoLane(1),
      read: new RepoLane(3),
      write: new RepoLane(1),
      // Lifecycle runs are long-lived (resolveTarget + testRemote =
      // up to 20s) and must not block snapshot/status refreshes.
      // Concurrency 1 per repo: a lifecycle run is its own critical
      // section — concurrent runs of the same repo would race the
      // lifecycle union writes.
      lifecycle: new RepoLane(1),
    },
    operations: {},
  }
}

function getRuntime(repoId: string): RepoRuntime {
  let runtime = runtimes.get(repoId)
  if (!runtime) {
    runtime = createRuntime()
    runtimes.set(repoId, runtime)
  }
  return runtime
}

export function nextRepoOperationId(repoId: string): number {
  const runtime = getRuntime(repoId)
  return runtime.nextOperationId++
}

function ensureRepoOperation(repoId: string, key: string): RepoOperationState {
  const operations = getRuntime(repoId).operations
  return (operations[key] ??= idleOperation())
}

export function repoOperation(repoId: string, key: string): RepoOperationState {
  return runtimes.get(repoId)?.operations[key] ?? idleOperation()
}

export function repoOperationBusy(repoId: string, key: string): boolean {
  return operationBusy(repoOperation(repoId, key))
}

export function repoOperationCurrent(repoId: string, key: string, operationId: number): boolean {
  return repoOperation(repoId, key).operationId === operationId
}

export function markRepoOperationTargets(
  repoId: string,
  operationId: number,
  targets: RepoOperationTarget[],
  phase: 'queued' | 'running',
  wasQueued = false,
): void {
  if (phase === 'running' && wasQueued) {
    const allTargetsQueuedForOperation = targets.every((target) => {
      const operation = repoOperation(repoId, target.key)
      return operation.operationId === operationId && operation.phase === 'queued'
    })
    if (!allTargetsQueuedForOperation) return
  }
  for (const target of targets) {
    const operation = ensureRepoOperation(repoId, target.key)
    if (phase === 'running') {
      startOperation(operation, operationId, { reason: target.reason, target: target.target })
    } else {
      queueOperation(operation, operationId, { reason: target.reason, target: target.target })
    }
  }
}

export function settleRepoOperationTargets(
  repoId: string,
  operationId: number,
  targets: RepoOperationTarget[],
  error: string | null,
): void {
  const runtime = runtimes.get(repoId)
  if (!runtime) return
  let settled = false
  for (const target of targets) {
    const operation = runtime.operations[target.key]
    if (operation && settleOperation(operation, operationId, { error })) settled = true
  }
  if (settled) notifyOperationIdleWaiters(repoId)
}

function notifyOperationIdleWaiters(repoId: string): void {
  const waiters = operationIdleWaiters.get(repoId)
  if (!waiters) return
  for (const waiter of [...waiters]) waiter()
}

export function waitForRepoOperationsIdle(
  repoId: string,
  keys: string[],
  signal?: AbortSignal,
): Promise<void> {
  if (keys.every((key) => !repoOperationBusy(repoId, key))) return Promise.resolve()
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      operationIdleWaiters.get(repoId)?.delete(check)
      signal?.removeEventListener('abort', abort)
    }
    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const fail = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('cancelled'))
    }
    const check = () => {
      if (keys.every((key) => !repoOperationBusy(repoId, key))) finish()
    }
    const abort = () => fail()
    if (signal?.aborted) {
      fail()
      return
    }
    const waiters = operationIdleWaiters.get(repoId) ?? new Set<() => void>()
    waiters.add(check)
    operationIdleWaiters.set(repoId, waiters)
    signal?.addEventListener('abort', abort, { once: true })
    check()
  })
}

export function pruneRepoBranchLogOperations(repoId: string, validBranches: Set<string>): void {
  const operations = runtimes.get(repoId)?.operations
  if (!operations) return
  for (const key of Object.keys(operations) as RepoOperationKey[]) {
    if (!key.startsWith('log:')) continue
    if (!validBranches.has(key.slice('log:'.length))) delete operations[key]
  }
}

export function pruneRepoBranchPullRequestOperations(repoId: string, validBranches: Set<string>): void {
  const operations = runtimes.get(repoId)?.operations
  if (!operations) return
  for (const key of Object.keys(operations) as RepoOperationKey[]) {
    if (!key.startsWith('pullRequest:')) continue
    if (!validBranches.has(key.slice('pullRequest:'.length))) delete operations[key]
  }
}

export function scheduleRepoTask<T>(
  repoId: string,
  lane: RepoTaskLane,
  task: (signal: AbortSignal) => Promise<T>,
  options?: RepoLaneOptions,
): Promise<T> {
  return getRuntime(repoId).queues[lane].add(task, options)
}

export function disposeRepoRuntime(repoId: string): void {
  const runtime = runtimes.get(repoId)
  if (!runtime) return
  for (const queue of Object.values(runtime.queues)) queue.cancelAll()
  runtimes.delete(repoId)
  notifyOperationIdleWaiters(repoId)
  operationIdleWaiters.delete(repoId)
}

export function disposeAllRepoRuntimes(): void {
  for (const repoId of runtimes.keys()) disposeRepoRuntime(repoId)
}
