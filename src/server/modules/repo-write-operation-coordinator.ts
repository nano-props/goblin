import PQueue from 'p-queue'
import {
  captureRepoWriteExecution,
  repoWriteExecutionBoundaryKey,
  resolveRepoWriteBoundaryKey,
  runWithCapturedRepoWriteExecution,
  type RepoSource,
  type RepoWriteExecutionCapability,
  validateRepoWriteExecution,
} from '#/server/modules/repo-source.ts'
import { publishRepoQueryInvalidation } from '#/server/modules/invalidation-broker.ts'
import { onWorkspaceRuntimeClosed } from '#/server/modules/workspace-runtimes.ts'
import type {
  RepoOperationCancellationReason,
  RepoOperationFailureReason,
  RepoServerOperationKind,
  RepoServerOperationSource,
  RepoServerOperationState,
  RepoServerOperationTarget,
} from '#/shared/api-types.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

type RepoWriteOperationQueue = PQueue

export interface RepoWriteOperationLifecycle {
  id: string
  start(): void
  requestCancel(reason: RepoOperationCancellationReason): void
  recordWaitCancellation(reason: RepoOperationCancellationReason): void
  settle(result: { ok: boolean; message?: string }): void
}

export interface RepoWriteOperationContext {
  recordFetchSuccess(): void
  runNetworkOperation<T extends ExecResult>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
  runWithRepoSource<T extends ExecResult>(task: (source: RepoSource) => Promise<T>): Promise<T>
}

interface BeginRepoWriteOperationInput {
  id?: string
  repoId?: WorkspaceId | null
  workspaceRuntimeId?: string | null
  kind: RepoServerOperationKind
  source: RepoServerOperationSource
  target?: RepoServerOperationTarget | null
  deadlineAt?: number | null
  canCancelUnderlying?: boolean
  execution?: RepoWriteExecutionCapability
}

export interface RepoWriteBoundaryHandle {
  readonly id: string
}

interface RepoWriteBoundaryGroup extends RepoWriteBoundaryHandle {
  readonly descriptor: string
  repoIds: Set<WorkspaceId>
  readonly queue: RepoWriteOperationQueue
  operations: Map<string, RepoServerOperationState>
  activeNetworkOperation: ActiveRepoWriteNetworkOperation | null
  lastSuccessfulFetchAt: number | null
}

interface ActiveRepoWriteNetworkOperation {
  ctrl: AbortController
  operation: RepoWriteOperationLifecycle
}

const MAX_SETTLED_OPERATIONS = 100

let nextWriteOperationId = 1
let nextBoundaryGroupId = 1
const boundaryGroups = new Set<RepoWriteBoundaryGroup>()
const boundaryGroupByRepoId = new Map<WorkspaceId, RepoWriteBoundaryGroup>()
const boundaryGroupByDescriptor = new Map<string, RepoWriteBoundaryGroup>()
let boundaryGroupByHandle = new WeakMap<RepoWriteBoundaryHandle, RepoWriteBoundaryGroup>()
let workspaceRuntimeCloseSubscription: (() => void) | null = null

function freshWriteOperationId(): string {
  return `repo-write-op-${nextWriteOperationId++}`
}

function createBoundaryGroup(descriptor: string): RepoWriteBoundaryGroup {
  const group: RepoWriteBoundaryGroup = {
    id: `repo-write-boundary-${nextBoundaryGroupId++}`,
    descriptor,
    repoIds: new Set(),
    queue: new PQueue({ concurrency: 1 }),
    operations: new Map(),
    activeNetworkOperation: null,
    lastSuccessfulFetchAt: null,
  }
  boundaryGroups.add(group)
  boundaryGroupByDescriptor.set(descriptor, group)
  boundaryGroupByHandle.set(group, group)
  return group
}

async function resolveRepoWriteBoundaryGroup(
  repoId: WorkspaceId,
  signal?: AbortSignal,
): Promise<RepoWriteBoundaryGroup> {
  const descriptor = await resolveRepoWriteBoundaryKey(repoId, signal)
  return bindRepoWriteBoundaryGroup(repoId, descriptor)
}

function bindRepoWriteBoundaryGroup(repoId: WorkspaceId, descriptor: string): RepoWriteBoundaryGroup {
  const previousGroup = boundaryGroupByRepoId.get(repoId)
  const group = boundaryGroupByDescriptor.get(descriptor) ?? createBoundaryGroup(descriptor)
  if (previousGroup !== group) previousGroup?.repoIds.delete(repoId)
  group.repoIds.add(repoId)
  boundaryGroupByRepoId.set(repoId, group)
  return group
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

function pruneSettledOperations(): void {
  const settled = [...boundaryGroups]
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
}

function beginRepoWriteOperation(
  runtime: RepoWriteBoundaryGroup,
  input: BeginRepoWriteOperationInput,
): RepoWriteOperationLifecycle {
  const now = Date.now()
  let settled = false
  const operation: RepoServerOperationState = {
    id: input.id ?? freshWriteOperationId(),
    repoId: input.repoId ?? null,
    workspaceRuntimeId: input.workspaceRuntimeId ?? null,
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
  registerRepoWriteOperationBoundaryRepoId(runtime, operation.repoId)
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
  runtime: RepoWriteBoundaryGroup,
  operation: Pick<RepoServerOperationState, 'repoId'>,
): void {
  const repoIds = new Set(runtime.repoIds)
  if (operation.repoId) repoIds.add(operation.repoId)
  for (const repoId of repoIds) {
    publishRepoQueryInvalidation({ repoId, query: 'repo-runtime' })
  }
}

function registerRepoWriteOperationBoundaryRepoId(group: RepoWriteBoundaryGroup, repoId: WorkspaceId | null | undefined) {
  ensureRepoRuntimeCloseSubscription()
  if (repoId) {
    boundaryGroupByRepoId.set(repoId, group)
    group.repoIds.add(repoId)
  }
  return group.repoIds
}

function unregisterRepoWriteOperationBoundaryRepoId(repoId: WorkspaceId): void {
  const group = boundaryGroupByRepoId.get(repoId)
  if (!group) return
  boundaryGroupByRepoId.delete(repoId)
  group.repoIds.delete(repoId)
}

function ensureRepoRuntimeCloseSubscription(): void {
  if (workspaceRuntimeCloseSubscription) return
  workspaceRuntimeCloseSubscription = onWorkspaceRuntimeClosed((event) => {
    unregisterRepoWriteOperationBoundaryRepoId(event.workspaceId)
  })
}

function cancelledRepoWriteResult<T extends ExecResult>(): T {
  return { ok: false, message: 'cancelled' } as T
}

async function runResolvedRepoWriteOperation<T extends ExecResult>(
  group: RepoWriteBoundaryGroup,
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
    return await group.queue.add(
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
  }
}

async function runRepoWriteNetworkOperation<T extends ExecResult>(
  runtime: RepoWriteBoundaryGroup,
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
  runtime: RepoWriteBoundaryGroup,
  operation: RepoWriteOperationLifecycle,
  execution: RepoWriteExecutionCapability,
  callerSignal: AbortSignal | undefined,
): RepoWriteOperationContext {
  return {
    recordFetchSuccess() {
      recordRepoBoundaryFetchSuccess(runtime)
    },
    async runNetworkOperation(task) {
      return await runRepoWriteNetworkOperation(runtime, operation, task, callerSignal)
    },
    async runWithRepoSource<T extends ExecResult>(task: (source: RepoSource) => Promise<T>) {
      if (!(await validateRepoWriteExecution(execution, callerSignal))) {
        const result = { ok: false, message: 'error.repository-target-changed' } as T
        operation.settle(result)
        return result
      }
      return await runWithCapturedRepoWriteExecution(execution, task)
    },
  }
}

export async function enqueueRepoWriteOperation<T extends ExecResult>(
  repoId: WorkspaceId,
  signal: AbortSignal | undefined,
  operationInput: BeginRepoWriteOperationInput,
  prepareTask: (operation: RepoWriteOperationLifecycle, context: RepoWriteOperationContext) => () => Promise<T>,
): Promise<T> {
  if (signal?.aborted) return cancelledRepoWriteResult()
  let execution: RepoWriteExecutionCapability
  try {
    execution =
      operationInput.execution ??
      (await captureRepoWriteExecution(
        repoId,
        operationInput.workspaceRuntimeId ? { workspaceRuntimeId: operationInput.workspaceRuntimeId } : undefined,
        signal,
      ))
  } catch (err) {
    if (signal?.aborted) return cancelledRepoWriteResult()
    throw err
  }
  if (signal?.aborted) return cancelledRepoWriteResult()
  const group = bindRepoWriteBoundaryGroup(repoId, repoWriteExecutionBoundaryKey(execution))
  // A write is admitted only after its canonical physical boundary is known.
  // Never create a queue from a locator fallback: an unresolved boundary must fail.
  registerRepoWriteOperationBoundaryRepoId(group, repoId)
  const operation = beginRepoWriteOperation(group, operationInput)
  const context = createRepoWriteOperationContext(group, operation, execution, signal)
  let task: () => Promise<T>
  try {
    task = prepareTask(operation, context)
  } catch (err) {
    operation.settle({ ok: false, message: err instanceof Error ? err.message : String(err) })
    throw err
  }
  return await runResolvedRepoWriteOperation(
    group,
    operation,
    async () => {
      try {
        return await task()
      } catch (err) {
        operation.settle({ ok: false, message: err instanceof Error ? err.message : String(err) })
        throw err
      }
    },
    signal,
  )
}

export async function listRepoWriteOperationsForRepo(
  repoId: WorkspaceId | undefined,
  options: { includeSettled?: boolean; workspaceRuntimeId?: string; signal?: AbortSignal } = {},
): Promise<RepoServerOperationState[]> {
  let runtimes: RepoWriteBoundaryGroup[]
  if (repoId) {
    const group = await resolveRepoWriteBoundaryGroup(repoId, options.signal)
    registerRepoWriteOperationBoundaryRepoId(group, repoId)
    runtimes = [group]
  } else {
    runtimes = [...boundaryGroups]
  }
  return listRuntimeOperations(runtimes, options)
}

function listRuntimeOperations(
  runtimes: RepoWriteBoundaryGroup[],
  options: { includeSettled?: boolean; workspaceRuntimeId?: string },
): RepoServerOperationState[] {
  const includeSettled = options.includeSettled === true
  return sortedOperations(
    runtimes.flatMap((runtime) =>
      [...runtime.operations.values()].filter((operation) => {
        if (
          options.workspaceRuntimeId &&
          operation.workspaceRuntimeId &&
          operation.workspaceRuntimeId !== options.workspaceRuntimeId
        ) {
          return false
        }
        if (!includeSettled && (operation.phase === 'done' || operation.phase === 'failed')) return false
        return true
      }),
    ),
  ).map(cloneOperation)
}

export function listRepoWriteOperationsForBoundary(
  repoId: WorkspaceId,
  handle: RepoWriteBoundaryHandle,
  options: { includeSettled?: boolean; workspaceRuntimeId?: string } = {},
): RepoServerOperationState[] {
  const group = boundaryGroupForHandle(handle)
  registerRepoWriteOperationBoundaryRepoId(group, repoId)
  return listRuntimeOperations([group], options)
}

export async function resolveRepoWriteBoundaryForRead(
  repoId: WorkspaceId,
  signal?: AbortSignal,
): Promise<RepoWriteBoundaryHandle> {
  return await resolveRepoWriteBoundaryGroup(repoId, signal)
}

function boundaryGroupForHandle(handle: RepoWriteBoundaryHandle): RepoWriteBoundaryGroup {
  const group = boundaryGroupByHandle.get(handle)
  if (!group) throw new Error('Unknown repository write boundary handle')
  return group
}

function recordRepoBoundaryFetchSuccess(group: RepoWriteBoundaryGroup): void {
  group.lastSuccessfulFetchAt = Math.max(group.lastSuccessfulFetchAt ?? 0, Date.now())
}

export function getRepoBoundaryLastFetchAt(handle: RepoWriteBoundaryHandle): number | null {
  return boundaryGroupForHandle(handle).lastSuccessfulFetchAt
}

export function resetRepoWriteOperationCoordinatorForTests(): void {
  boundaryGroups.clear()
  boundaryGroupByRepoId.clear()
  boundaryGroupByDescriptor.clear()
  boundaryGroupByHandle = new WeakMap()
  workspaceRuntimeCloseSubscription?.()
  workspaceRuntimeCloseSubscription = null
  nextWriteOperationId = 1
  nextBoundaryGroupId = 1
}

export function repoWriteOperationCoordinatorStatsForTests(): {
  boundaryRuntimes: number
  registeredBoundaries: number
  registeredRepoIds: number
  queuedOperations: number
  runningOperations: number
} {
  const runtimes = [...boundaryGroups]
  return {
    boundaryRuntimes: runtimes.length,
    registeredBoundaries: boundaryGroupByDescriptor.size,
    registeredRepoIds: boundaryGroupByRepoId.size,
    queuedOperations: runtimes.reduce((total, runtime) => total + runtime.queue.size, 0),
    runningOperations: runtimes.reduce((total, runtime) => total + runtime.queue.pending, 0),
  }
}
