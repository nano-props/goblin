import {
  idleOperation,
  operationBusy,
  queueOperation,
  settleOperation,
  startOperation,
  type RepoOperationReason,
  type RepoOperationState,
} from '#/renderer/stores/repos/operations.ts'

export type RepoTaskLane = 'network' | 'read' | 'write'

export type RepoOperationKey =
  | 'fetch'
  | 'snapshot'
  | 'status'
  | 'pullRequests'
  | 'branchAction'
  | `log:${string}`
  | `pullRequest:${string}`

export interface RepoRuntimeOperationTarget {
  key: RepoOperationKey
  reason: RepoOperationReason
  target?: string | null
}

interface QueuedRepoTask<T> {
  task: (signal: AbortSignal) => Promise<T>
  priority: number
  replaceKey?: string
  ctrl: AbortController
  onStart?: (wasQueued: boolean) => void
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

interface RepoLaneOptions {
  priority?: number
  replaceQueuedKey?: string
  onQueued?: () => void
  onStart?: (wasQueued: boolean) => void
}

class RepoLane {
  private active = 0
  private activeControllers = new Set<AbortController>()
  private queued: Array<QueuedRepoTask<unknown>> = []

  constructor(private readonly concurrency: number) {}

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
      if (queuedTask.replaceKey) this.cancelQueued(queuedTask.replaceKey)
      if (this.active < this.concurrency) this.start(queuedTask, false)
      else {
        options?.onQueued?.()
        this.enqueue(queuedTask as QueuedRepoTask<unknown>)
      }
    })
  }

  cancelAll(): void {
    for (const ctrl of this.activeControllers) ctrl.abort()
    const queued = this.queued
    this.queued = []
    for (const task of queued) {
      task.ctrl.abort()
      task.reject(new Error('cancelled'))
    }
  }

  private start<T>(queuedTask: QueuedRepoTask<T>, wasQueued: boolean): void {
    this.active += 1
    this.activeControllers.add(queuedTask.ctrl)
    let work: Promise<T>
    try {
      queuedTask.onStart?.(wasQueued)
      work = queuedTask.task(queuedTask.ctrl.signal)
    } catch (err) {
      this.activeControllers.delete(queuedTask.ctrl)
      this.active -= 1
      queuedTask.reject(err)
      this.drain()
      return
    }
    work.then(queuedTask.resolve, queuedTask.reject).finally(() => {
      this.activeControllers.delete(queuedTask.ctrl)
      this.active -= 1
      this.drain()
    })
  }

  private enqueue(task: QueuedRepoTask<unknown>): void {
    const index = this.queued.findIndex((queued) => queued.priority < task.priority)
    this.queued.splice(index === -1 ? this.queued.length : index, 0, task)
  }

  private cancelQueued(replaceKey: string): void {
    const keep: Array<QueuedRepoTask<unknown>> = []
    for (const task of this.queued) {
      if (task.replaceKey !== replaceKey) {
        keep.push(task)
        continue
      }
      task.ctrl.abort()
      task.reject(new Error('cancelled'))
    }
    this.queued = keep
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
  operations: Partial<Record<RepoOperationKey, RepoOperationState>>
}

const runtimes = new Map<string, RepoRuntime>()

function createRuntime(): RepoRuntime {
  return {
    nextOperationId: 1,
    queues: {
      network: new RepoLane(1),
      read: new RepoLane(3),
      write: new RepoLane(1),
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

function ensureRepoOperation(repoId: string, key: RepoOperationKey): RepoOperationState {
  const operations = getRuntime(repoId).operations
  return (operations[key] ??= idleOperation())
}

export function repoOperation(repoId: string, key: RepoOperationKey): RepoOperationState {
  return runtimes.get(repoId)?.operations[key] ?? idleOperation()
}

export function repoOperationBusy(repoId: string, key: RepoOperationKey): boolean {
  return operationBusy(repoOperation(repoId, key))
}

export function repoOperationCurrent(repoId: string, key: RepoOperationKey, operationId: number): boolean {
  return repoOperation(repoId, key).operationId === operationId
}

export function markRepoOperationTargets(
  repoId: string,
  operationId: number,
  targets: RepoRuntimeOperationTarget[],
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
  targets: RepoRuntimeOperationTarget[],
  error: string | null,
): void {
  const runtime = runtimes.get(repoId)
  if (!runtime) return
  for (const target of targets) {
    const operation = runtime.operations[target.key]
    if (operation) settleOperation(operation, operationId, { error })
  }
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
}

export function disposeAllRepoRuntimes(): void {
  for (const repoId of runtimes.keys()) disposeRepoRuntime(repoId)
}
