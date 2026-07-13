import PQueue from 'p-queue'
import { resolveRepoWriteBoundaryKey } from '#/server/modules/repo-source.ts'
import { publishRepoQueryInvalidation } from '#/server/modules/invalidation-broker.ts'
import { onRepoRuntimeClosed } from '#/server/modules/repo-runtimes.ts'
import type {
  RepoOperationCancellationReason,
  RepoOperationFailureReason,
  RepoServerOperationKind,
  RepoServerOperationSource,
  RepoServerOperationState,
  RepoServerOperationTarget,
} from '#/shared/api-types.ts'
import type { ExecResult } from '#/shared/git-types.ts'

type RepoWriteOperationQueue = PQueue

export interface RepoWriteOperationLifecycle {
  id: string
  start(): void
  requestCancel(reason: RepoOperationCancellationReason): void
  recordWaitCancellation(reason: RepoOperationCancellationReason): void
  settle(result: { ok: boolean; message?: string }): void
}

export interface RepoWriteOperationContext {
  runNetworkOperation<T extends ExecResult>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
}

interface BeginRepoWriteOperationInput {
  id?: string
  repoId?: string | null
  repoRuntimeId?: string | null
  kind: RepoServerOperationKind
  source: RepoServerOperationSource
  target?: RepoServerOperationTarget | null
  deadlineAt?: number | null
  canCancelUnderlying?: boolean
}

interface RepoWriteOperationQueueRuntime {
  boundaryKey: string
  repoIds: Set<string>
  queue: RepoWriteOperationQueue
  operations: Map<string, RepoServerOperationState>
  activeNetworkOperation: ActiveRepoWriteNetworkOperation | null
}

interface ActiveRepoWriteNetworkOperation {
  ctrl: AbortController
  operation: RepoWriteOperationLifecycle
}

const MAX_SETTLED_OPERATIONS = 100

let nextWriteOperationId = 1
const repoWriteOperationRuntimesByBoundary = new Map<string, RepoWriteOperationQueueRuntime>()
const repoWriteOperationRepoIdsByBoundary = new Map<string, Set<string>>()
const repoWriteOperationBoundaryByRepoId = new Map<string, string>()
let repoRuntimeCloseSubscription: (() => void) | null = null

function freshWriteOperationId(): string {
  return `repo-write-op-${nextWriteOperationId++}`
}

function cloneOperation(state: RepoServerOperationState): RepoServerOperationState {
  return {
    ...state,
    target: state.target ? { ...state.target } : null,
    error: state.error ? { ...state.error } : null,
    cancellation: { ...state.cancellation },
  }
}

function operationFailureReasonForMessage(
  message: string | null | undefined,
  cancellationReason: RepoOperationCancellationReason | null,
): RepoOperationFailureReason | null {
  if (cancellationReason) return cancellationReason
  if (message === 'cancelled') return 'caller-abort'
  return null
}

function sortedOperations(states: RepoServerOperationState[]): RepoServerOperationState[] {
  return [...states].sort((a, b) => {
    const aTime = a.settledAt ?? a.startedAt ?? a.queuedAt
    const bTime = b.settledAt ?? b.startedAt ?? b.queuedAt
    return bTime - aTime
  })
}

function deleteIdleEmptyRuntimes(): void {
  for (const [boundaryKey, runtime] of repoWriteOperationRuntimesByBoundary) {
    if (
      runtime.queue.size === 0 &&
      runtime.queue.pending === 0 &&
      runtime.operations.size === 0 &&
      !runtime.activeNetworkOperation
    ) {
      repoWriteOperationRuntimesByBoundary.delete(boundaryKey)
      deleteRepoWriteOperationBoundaryIfEmpty(boundaryKey)
    }
  }
}

function pruneSettledOperations(): void {
  const settled = [...repoWriteOperationRuntimesByBoundary.values()]
    .flatMap((runtime) =>
      [...runtime.operations.values()]
        .filter((operation) => operation.phase === 'done' || operation.phase === 'failed')
        .map((operation) => ({ runtime, operation })),
    )
    .sort((a, b) => {
      const aTime = a.operation.settledAt ?? a.operation.startedAt ?? a.operation.queuedAt
      const bTime = b.operation.settledAt ?? b.operation.startedAt ?? b.operation.queuedAt
      return bTime - aTime
    })

  for (const { runtime, operation } of settled.slice(MAX_SETTLED_OPERATIONS)) {
    runtime.operations.delete(operation.id)
  }
  deleteIdleEmptyRuntimes()
}

function beginRepoWriteOperation(
  runtime: RepoWriteOperationQueueRuntime,
  input: BeginRepoWriteOperationInput,
): RepoWriteOperationLifecycle {
  const now = Date.now()
  let settled = false
  const operation: RepoServerOperationState = {
    id: input.id ?? freshWriteOperationId(),
    repoId: input.repoId ?? null,
    repoRuntimeId: input.repoRuntimeId ?? null,
    kind: input.kind,
    phase: 'queued',
    source: input.source,
    target: input.target ? { ...input.target } : null,
    queuedAt: now,
    startedAt: null,
    deadlineAt: input.deadlineAt ?? null,
    settledAt: null,
    error: null,
    cancellation: {
      underlyingRequested: false,
      reason: null,
      requestedAt: null,
      waitCancelledCount: 0,
      lastWaitCancelledAt: null,
      lastWaitCancellationReason: null,
    },
    canCancelUnderlying: input.canCancelUnderlying ?? true,
  }
  runtime.operations.set(operation.id, operation)
  registerRepoWriteOperationBoundaryRepoId(runtime.boundaryKey, operation.repoId)
  publishRepoRuntimeInvalidation(runtime, operation)
  return {
    id: operation.id,
    start() {
      operation.phase = operation.cancellation.underlyingRequested ? 'cancelling' : 'running'
      operation.startedAt = Date.now()
      publishRepoRuntimeInvalidation(runtime, operation)
    },
    requestCancel(reason) {
      operation.cancellation.underlyingRequested = true
      operation.cancellation.reason = reason
      operation.cancellation.requestedAt = Date.now()
      if (operation.phase === 'queued' || operation.phase === 'running') operation.phase = 'cancelling'
      publishRepoRuntimeInvalidation(runtime, operation)
    },
    recordWaitCancellation(reason) {
      operation.cancellation.waitCancelledCount += 1
      operation.cancellation.lastWaitCancelledAt = Date.now()
      operation.cancellation.lastWaitCancellationReason = reason
      publishRepoRuntimeInvalidation(runtime, operation)
    },
    settle(result) {
      if (settled) return
      settled = true
      const cancellationReason = operation.cancellation.reason
      operation.phase = result.ok ? 'done' : 'failed'
      operation.settledAt = Date.now()
      operation.error = result.ok
        ? null
        : {
            message: result.message ?? 'error.failed-read-repo',
            reason: operationFailureReasonForMessage(result.message, cancellationReason),
          }
      publishRepoRuntimeInvalidation(runtime, operation)
      pruneSettledOperations()
    },
  }
}

function publishRepoRuntimeInvalidation(
  runtime: RepoWriteOperationQueueRuntime,
  operation: Pick<RepoServerOperationState, 'repoId'>,
): void {
  const repoIds = new Set(runtime.repoIds)
  if (operation.repoId) repoIds.add(operation.repoId)
  for (const repoId of repoIds) {
    publishRepoQueryInvalidation({ repoId, query: 'repo-runtime' })
  }
}

function registerRepoWriteOperationBoundaryRepoId(boundaryKey: string, repoId: string | null | undefined): Set<string> {
  ensureRepoRuntimeCloseSubscription()
  let repoIds = repoWriteOperationRepoIdsByBoundary.get(boundaryKey)
  if (!repoIds) {
    repoIds = new Set()
    repoWriteOperationRepoIdsByBoundary.set(boundaryKey, repoIds)
  }
  if (repoId) {
    const previousBoundaryKey = repoWriteOperationBoundaryByRepoId.get(repoId)
    if (previousBoundaryKey && previousBoundaryKey !== boundaryKey) {
      repoWriteOperationRepoIdsByBoundary.get(previousBoundaryKey)?.delete(repoId)
      deleteRepoWriteOperationBoundaryIfEmpty(previousBoundaryKey)
    }
    repoWriteOperationBoundaryByRepoId.set(repoId, boundaryKey)
    repoIds.add(repoId)
  }
  return repoIds
}

function unregisterRepoWriteOperationBoundaryRepoId(repoId: string): void {
  const boundaryKey = repoWriteOperationBoundaryByRepoId.get(repoId)
  if (!boundaryKey) return
  repoWriteOperationBoundaryByRepoId.delete(repoId)
  repoWriteOperationRepoIdsByBoundary.get(boundaryKey)?.delete(repoId)
  deleteRepoWriteOperationBoundaryIfEmpty(boundaryKey)
}

function deleteRepoWriteOperationBoundaryIfEmpty(boundaryKey: string): void {
  const repoIds = repoWriteOperationRepoIdsByBoundary.get(boundaryKey)
  if (repoIds && repoIds.size > 0) return
  if (repoWriteOperationRuntimesByBoundary.has(boundaryKey)) return
  repoWriteOperationRepoIdsByBoundary.delete(boundaryKey)
}

function ensureRepoRuntimeCloseSubscription(): void {
  if (repoRuntimeCloseSubscription) return
  repoRuntimeCloseSubscription = onRepoRuntimeClosed((event) => {
    unregisterRepoWriteOperationBoundaryRepoId(event.repoRoot)
  })
}

function repoWriteOperationRuntimeForBoundary(
  boundaryKey: string,
  repoId?: string | null,
): RepoWriteOperationQueueRuntime {
  const repoIds = registerRepoWriteOperationBoundaryRepoId(boundaryKey, repoId)
  let runtime = repoWriteOperationRuntimesByBoundary.get(boundaryKey)
  if (!runtime) {
    runtime = {
      boundaryKey,
      repoIds,
      queue: new PQueue({ concurrency: 1 }),
      operations: new Map(),
      activeNetworkOperation: null,
    }
    repoWriteOperationRuntimesByBoundary.set(boundaryKey, runtime)
  }
  return runtime
}

function scheduleRepoWriteOperationQueueCleanup(boundaryKey: string, runtime: RepoWriteOperationQueueRuntime): void {
  void runtime.queue.onIdle().then(() => {
    if (repoWriteOperationRuntimesByBoundary.get(boundaryKey) !== runtime) return
    deleteIdleEmptyRuntimes()
  })
}

function cancelledRepoWriteResult<T extends ExecResult>(): T {
  return { ok: false, message: 'cancelled' } as T
}

async function runResolvedRepoWriteOperation<T extends ExecResult>(
  boundaryKey: string,
  runtime: RepoWriteOperationQueueRuntime,
  operation: RepoWriteOperationLifecycle,
  task: () => Promise<T>,
  callerSignal?: AbortSignal,
): Promise<T> {
  const queuedAbortCtrl = callerSignal ? new AbortController() : null
  let started = false
  let queuedCancelled = false
  const cancelQueuedOperation = () => {
    if (started || queuedCancelled) return
    queuedCancelled = true
    operation.recordWaitCancellation('caller-abort')
    operation.settle(cancelledRepoWriteResult())
    queuedAbortCtrl?.abort(callerSignal?.reason)
  }

  if (callerSignal?.aborted) cancelQueuedOperation()
  else callerSignal?.addEventListener('abort', cancelQueuedOperation, { once: true })

  try {
    return await runtime.queue.add(
      async () => {
        started = true
        callerSignal?.removeEventListener('abort', cancelQueuedOperation)
        return await task()
      },
      queuedAbortCtrl ? { signal: queuedAbortCtrl.signal } : undefined,
    )
  } catch (err) {
    if (queuedCancelled) return cancelledRepoWriteResult()
    throw err
  } finally {
    callerSignal?.removeEventListener('abort', cancelQueuedOperation)
    scheduleRepoWriteOperationQueueCleanup(boundaryKey, runtime)
  }
}

async function runRepoWriteNetworkOperation<T extends ExecResult>(
  runtime: RepoWriteOperationQueueRuntime,
  operation: RepoWriteOperationLifecycle,
  task: (signal: AbortSignal) => Promise<T>,
  callerSignal?: AbortSignal,
): Promise<T> {
  if (callerSignal?.aborted) {
    operation.recordWaitCancellation('caller-abort')
    const result = { ok: false, message: 'cancelled' }
    operation.settle(result)
    return result as T
  }
  if (runtime.activeNetworkOperation) {
    const result = { ok: false, message: 'error.network-op-in-progress' }
    operation.settle(result)
    return result as T
  }

  const ctrl = new AbortController()
  const slot: ActiveRepoWriteNetworkOperation = { ctrl, operation }
  const onCallerAbort = () => {
    operation.requestCancel('caller-abort')
    ctrl.abort(callerSignal?.reason)
  }
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
  runtime.activeNetworkOperation = slot
  operation.start()
  try {
    const result = await task(ctrl.signal)
    operation.settle(result)
    return result
  } catch (err) {
    operation.settle({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    })
    throw err
  } finally {
    callerSignal?.removeEventListener('abort', onCallerAbort)
    if (runtime.activeNetworkOperation === slot) runtime.activeNetworkOperation = null
  }
}

function createRepoWriteOperationContext(
  runtime: RepoWriteOperationQueueRuntime,
  operation: RepoWriteOperationLifecycle,
  callerSignal: AbortSignal | undefined,
): RepoWriteOperationContext {
  return {
    async runNetworkOperation(task) {
      return await runRepoWriteNetworkOperation(runtime, operation, task, callerSignal)
    },
  }
}

export async function enqueueRepoWriteOperation<T extends ExecResult>(
  repoId: string,
  signal: AbortSignal | undefined,
  operationInput: BeginRepoWriteOperationInput,
  prepareTask: (operation: RepoWriteOperationLifecycle, context: RepoWriteOperationContext) => () => Promise<T>,
): Promise<T> {
  if (signal?.aborted) return cancelledRepoWriteResult()
  let boundaryKey: string
  try {
    boundaryKey = await resolveRepoWriteBoundaryKey(repoId, signal)
  } catch (err) {
    if (signal?.aborted) return cancelledRepoWriteResult()
    throw err
  }
  if (signal?.aborted) return cancelledRepoWriteResult()

  // Registry admission is intentionally synchronous. Independent repositories
  // resolve concurrently, while aliases that resolve to the same physical
  // boundary still enter the same PQueue before the next async turn.
  const runtime = repoWriteOperationRuntimeForBoundary(boundaryKey, repoId)
  const operation = beginRepoWriteOperation(runtime, operationInput)
  const context = createRepoWriteOperationContext(runtime, operation, signal)
  let task: () => Promise<T>
  try {
    task = prepareTask(operation, context)
  } catch (err) {
    operation.settle({ ok: false, message: err instanceof Error ? err.message : String(err) })
    throw err
  }
  return await runResolvedRepoWriteOperation(boundaryKey, runtime, operation, async () => {
    try {
      return await task()
    } catch (err) {
      operation.settle({ ok: false, message: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }, signal)
}

export async function abortRepoWriteNetworkOperation(
  repoId: string,
  options: { signal?: AbortSignal } = {},
): Promise<boolean> {
  const boundaryKey = await resolveRepoWriteBoundaryKey(repoId, options.signal)
  registerRepoWriteOperationBoundaryRepoId(boundaryKey, repoId)
  const active = repoWriteOperationRuntimesByBoundary.get(boundaryKey)?.activeNetworkOperation
  if (!active) return false
  active.operation.requestCancel('user-cancel')
  active.ctrl.abort()
  return true
}

export async function listRepoWriteOperationsForRepo(
  repoId: string | undefined,
  options: { includeSettled?: boolean; repoRuntimeId?: string; signal?: AbortSignal } = {},
): Promise<RepoServerOperationState[]> {
  const includeSettled = options.includeSettled === true
  let runtimes: RepoWriteOperationQueueRuntime[]
  if (repoId) {
    const boundaryKey = await resolveRepoWriteBoundaryKey(repoId, options.signal)
    registerRepoWriteOperationBoundaryRepoId(boundaryKey, repoId)
    const runtime = repoWriteOperationRuntimesByBoundary.get(boundaryKey)
    if (!runtime) return []
    runtimes = [runtime]
  } else {
    runtimes = [...repoWriteOperationRuntimesByBoundary.values()]
  }
  return sortedOperations(
    runtimes.flatMap((runtime) =>
      [...runtime.operations.values()].filter((operation) => {
        if (options.repoRuntimeId && operation.repoRuntimeId && operation.repoRuntimeId !== options.repoRuntimeId) {
          return false
        }
        if (!includeSettled && (operation.phase === 'done' || operation.phase === 'failed')) return false
        return true
      }),
    ),
  ).map(cloneOperation)
}

export function resetRepoWriteOperationCoordinatorForTests(): void {
  repoWriteOperationRuntimesByBoundary.clear()
  repoWriteOperationRepoIdsByBoundary.clear()
  repoWriteOperationBoundaryByRepoId.clear()
  repoRuntimeCloseSubscription?.()
  repoRuntimeCloseSubscription = null
  nextWriteOperationId = 1
}

export function repoWriteOperationCoordinatorStatsForTests(): {
  boundaryRuntimes: number
  registeredBoundaries: number
  registeredRepoIds: number
  queuedOperations: number
  runningOperations: number
} {
  const runtimes = [...repoWriteOperationRuntimesByBoundary.values()]
  return {
    boundaryRuntimes: runtimes.length,
    registeredBoundaries: repoWriteOperationRepoIdsByBoundary.size,
    registeredRepoIds: repoWriteOperationBoundaryByRepoId.size,
    queuedOperations: runtimes.reduce((total, runtime) => total + runtime.queue.size, 0),
    runningOperations: runtimes.reduce((total, runtime) => total + runtime.queue.pending, 0),
  }
}
