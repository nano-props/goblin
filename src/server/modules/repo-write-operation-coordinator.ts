import PQueue from 'p-queue'
import { resolveRepoWriteBoundaryKey } from '#/server/modules/repo-source.ts'
import { publishRepoQueryInvalidation } from '#/server/modules/invalidation-broker.ts'
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
let repoWriteOperationAdmission: Promise<void> = Promise.resolve()

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
  publishRepoRuntimeInvalidation(operation)
  return {
    id: operation.id,
    start() {
      operation.phase = operation.cancellation.underlyingRequested ? 'cancelling' : 'running'
      operation.startedAt = Date.now()
      publishRepoRuntimeInvalidation(operation)
    },
    requestCancel(reason) {
      operation.cancellation.underlyingRequested = true
      operation.cancellation.reason = reason
      operation.cancellation.requestedAt = Date.now()
      if (operation.phase === 'queued' || operation.phase === 'running') operation.phase = 'cancelling'
      publishRepoRuntimeInvalidation(operation)
    },
    recordWaitCancellation(reason) {
      operation.cancellation.waitCancelledCount += 1
      operation.cancellation.lastWaitCancelledAt = Date.now()
      operation.cancellation.lastWaitCancellationReason = reason
      publishRepoRuntimeInvalidation(operation)
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
      publishRepoRuntimeInvalidation(operation)
      pruneSettledOperations()
    },
  }
}

function publishRepoRuntimeInvalidation(operation: Pick<RepoServerOperationState, 'repoId'>): void {
  if (!operation.repoId) return
  publishRepoQueryInvalidation({ repoId: operation.repoId, query: 'repo-runtime' })
}

async function acquireRepoWriteOperationAdmission(): Promise<() => void> {
  const previous = repoWriteOperationAdmission
  let release!: () => void
  const next = new Promise<void>((resolve) => {
    release = resolve
  })
  repoWriteOperationAdmission = previous.then(() => next)
  await previous
  return release
}

function repoWriteOperationRuntimeForBoundary(boundaryKey: string): RepoWriteOperationQueueRuntime {
  let runtime = repoWriteOperationRuntimesByBoundary.get(boundaryKey)
  if (!runtime) {
    runtime = { queue: new PQueue({ concurrency: 1 }), operations: new Map(), activeNetworkOperation: null }
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

async function runResolvedRepoWriteOperation<T>(
  boundaryKey: string,
  runtime: RepoWriteOperationQueueRuntime,
  task: () => Promise<T>,
): Promise<T> {
  try {
    return await runtime.queue.add(task)
  } finally {
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

export async function enqueueRepoWriteOperation<T>(
  repoId: string,
  signal: AbortSignal | undefined,
  operationInput: BeginRepoWriteOperationInput,
  prepareTask: (operation: RepoWriteOperationLifecycle, context: RepoWriteOperationContext) => () => Promise<T>,
): Promise<T> {
  const releaseAdmission = await acquireRepoWriteOperationAdmission()
  let work!: Promise<T>
  try {
    const boundaryKey = await resolveRepoWriteBoundaryKey(repoId, signal)
    const runtime = repoWriteOperationRuntimeForBoundary(boundaryKey)
    const operation = beginRepoWriteOperation(runtime, operationInput)
    const context = createRepoWriteOperationContext(runtime, operation, signal)
    let task: () => Promise<T>
    try {
      task = prepareTask(operation, context)
    } catch (err) {
      operation.settle({ ok: false, message: err instanceof Error ? err.message : String(err) })
      throw err
    }
    work = runResolvedRepoWriteOperation(boundaryKey, runtime, async () => {
      try {
        return await task()
      } catch (err) {
        operation.settle({ ok: false, message: err instanceof Error ? err.message : String(err) })
        throw err
      }
    })
  } finally {
    releaseAdmission()
  }
  return await work
}

export async function abortRepoWriteNetworkOperation(
  repoId: string,
  options: { signal?: AbortSignal } = {},
): Promise<boolean> {
  const boundaryKey = await resolveRepoWriteBoundaryKey(repoId, options.signal)
  const active = repoWriteOperationRuntimesByBoundary.get(boundaryKey)?.activeNetworkOperation
  if (!active) return false
  active.operation.requestCancel('user-cancel')
  active.ctrl.abort()
  return true
}

export async function listRepoWriteOperationsForRepo(
  repoId: string | undefined,
  options: { includeSettled?: boolean; signal?: AbortSignal } = {},
): Promise<RepoServerOperationState[]> {
  const includeSettled = options.includeSettled === true
  let runtimes: RepoWriteOperationQueueRuntime[]
  if (repoId) {
    const boundaryKey = await resolveRepoWriteBoundaryKey(repoId, options.signal)
    const runtime = repoWriteOperationRuntimesByBoundary.get(boundaryKey)
    if (!runtime) return []
    runtimes = [runtime]
  } else {
    runtimes = [...repoWriteOperationRuntimesByBoundary.values()]
  }
  return sortedOperations(
    runtimes.flatMap((runtime) =>
      [...runtime.operations.values()].filter((operation) => {
        if (!includeSettled && (operation.phase === 'done' || operation.phase === 'failed')) return false
        return true
      }),
    ),
  ).map(cloneOperation)
}

export function resetRepoWriteOperationCoordinatorForTests(): void {
  repoWriteOperationRuntimesByBoundary.clear()
  repoWriteOperationAdmission = Promise.resolve()
  nextWriteOperationId = 1
}
