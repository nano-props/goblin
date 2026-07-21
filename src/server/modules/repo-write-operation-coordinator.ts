import PQueue from 'p-queue'
import {
  captureRepoWriteExecution,
  repoWriteExecutionBoundaryKey,
  repoWriteExecutionCoordinationKey,
  resolveRepoWriteBoundaryIdentity,
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
import { WorkspaceRuntimeAdmissionClosedError } from '#/server/modules/workspace-runtime-admission-error.ts'

export interface RepoWriteOperationLifecycle {
  id: string
  start(): void
  requestCancel(reason: RepoOperationCancellationReason): void
  recordWaitCancellation(reason: RepoOperationCancellationReason): void
  settle(result: { ok: boolean; message?: string }): void
}

export interface RepoWriteOperationContext {
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
  readonly coordinationDescriptor: string
  repoIds: Set<WorkspaceId>
  readonly queue: PQueue
  operations: Map<string, RepoServerOperationState>
  lastSuccessfulFetchAt: number | null
}

interface WorkspaceRuntimeBoundaryRegistration {
  readonly repoId: WorkspaceId
  readonly workspaceRuntimeId: string
  active: boolean
}

const MAX_SETTLED_OPERATIONS = 100

let nextWriteOperationId = 1
let nextBoundaryGroupId = 1
const boundaryGroups = new Set<RepoWriteBoundaryGroup>()
const boundaryGroupByRepoId = new Map<WorkspaceId, RepoWriteBoundaryGroup>()
const boundaryGroupByDescriptor = new Map<string, RepoWriteBoundaryGroup>()
const queueByCoordinationDescriptor = new Map<string, PQueue>()
const workspaceRuntimeRegistrationsByRepoId = new Map<
  WorkspaceId,
  Map<string, WorkspaceRuntimeBoundaryRegistration>
>()
let boundaryGroupByHandle = new WeakMap<RepoWriteBoundaryHandle, RepoWriteBoundaryGroup>()
let workspaceRuntimeCloseSubscription: (() => void) | null = null

function freshWriteOperationId(): string {
  return `repo-write-op-${nextWriteOperationId++}`
}

function createBoundaryGroup(descriptor: string, coordinationDescriptor: string): RepoWriteBoundaryGroup {
  let queue = queueByCoordinationDescriptor.get(coordinationDescriptor)
  if (!queue) {
    queue = new PQueue({ concurrency: 1 })
    queueByCoordinationDescriptor.set(coordinationDescriptor, queue)
  }
  const group: RepoWriteBoundaryGroup = {
    id: `repo-write-boundary-${nextBoundaryGroupId++}`,
    descriptor,
    coordinationDescriptor,
    repoIds: new Set(),
    queue,
    operations: new Map(),
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
  runtimeRegistration?: WorkspaceRuntimeBoundaryRegistration | null,
): Promise<RepoWriteBoundaryGroup> {
  const identity = await resolveRepoWriteBoundaryIdentity(repoId, signal)
  assertWorkspaceRuntimeRegistrationActive(runtimeRegistration)
  return bindRepoWriteBoundaryGroup(repoId, identity.repositoryKey, identity.coordinationKey)
}

function bindRepoWriteBoundaryGroup(
  repoId: WorkspaceId,
  descriptor: string,
  coordinationDescriptor: string,
): RepoWriteBoundaryGroup {
  ensureRepoRuntimeCloseSubscription()
  const previousGroup = boundaryGroupByRepoId.get(repoId)
  const group =
    boundaryGroupByDescriptor.get(descriptor) ?? createBoundaryGroup(descriptor, coordinationDescriptor)
  if (previousGroup !== group && previousGroup) {
    previousGroup.repoIds.delete(repoId)
    deleteBoundaryGroupIfIdle(previousGroup)
  }
  group.repoIds.add(repoId)
  boundaryGroupByRepoId.set(repoId, group)
  return group
}

function registerWorkspaceRuntime(
  repoId: WorkspaceId,
  workspaceRuntimeId: string | null | undefined,
): WorkspaceRuntimeBoundaryRegistration | null {
  if (!workspaceRuntimeId) return null
  ensureRepoRuntimeCloseSubscription()
  let registrations = workspaceRuntimeRegistrationsByRepoId.get(repoId)
  if (!registrations) {
    registrations = new Map()
    workspaceRuntimeRegistrationsByRepoId.set(repoId, registrations)
  }
  const existing = registrations.get(workspaceRuntimeId)
  if (existing) return existing
  const registration = { repoId, workspaceRuntimeId, active: true }
  registrations.set(workspaceRuntimeId, registration)
  return registration
}

function assertWorkspaceRuntimeRegistrationActive(
  registration: WorkspaceRuntimeBoundaryRegistration | null | undefined,
): void {
  if (registration && !registration.active) throw new WorkspaceRuntimeAdmissionClosedError()
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
    deleteBoundaryGroupIfIdle(runtime)
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
      if (result.ok && operation.kind === 'fetch') recordRepoBoundaryFetchSuccess(runtime)
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

function registerRepoWriteOperationBoundaryRepoId(
  group: RepoWriteBoundaryGroup,
  repoId: WorkspaceId | null | undefined,
) {
  ensureRepoRuntimeCloseSubscription()
  if (repoId) {
    boundaryGroupByRepoId.set(repoId, group)
    group.repoIds.add(repoId)
  }
  return group.repoIds
}

function unregisterRepoWriteOperationBoundaryRepoId(repoId: WorkspaceId, workspaceRuntimeId: string): void {
  const registrations = workspaceRuntimeRegistrationsByRepoId.get(repoId)
  const registration = registrations?.get(workspaceRuntimeId)
  if (!registrations || !registration) return
  registration.active = false
  registrations.delete(workspaceRuntimeId)
  if (registrations.size > 0) return
  workspaceRuntimeRegistrationsByRepoId.delete(repoId)
  const group = boundaryGroupByRepoId.get(repoId)
  if (!group) return
  boundaryGroupByRepoId.delete(repoId)
  group.repoIds.delete(repoId)
  deleteBoundaryGroupIfIdle(group)
}

function deleteBoundaryGroupIfIdle(group: RepoWriteBoundaryGroup): void {
  if (group.repoIds.size > 0 || group.operations.size > 0) return
  boundaryGroups.delete(group)
  if (boundaryGroupByDescriptor.get(group.descriptor) === group) boundaryGroupByDescriptor.delete(group.descriptor)
  boundaryGroupByHandle.delete(group)
  deleteCoordinationQueueIfUnreferenced(group.coordinationDescriptor, group.queue)
}

function deleteCoordinationQueueIfUnreferenced(coordinationDescriptor: string, queue: PQueue): void {
  if ([...boundaryGroups].some((candidate) => candidate.coordinationDescriptor === coordinationDescriptor)) return
  if (queue.size > 0 || queue.pending > 0) {
    void queue.onIdle().then(() => deleteCoordinationQueueIfUnreferenced(coordinationDescriptor, queue))
    return
  }
  if (queueByCoordinationDescriptor.get(coordinationDescriptor) === queue) {
    queueByCoordinationDescriptor.delete(coordinationDescriptor)
  }
}

function ensureRepoRuntimeCloseSubscription(): void {
  if (workspaceRuntimeCloseSubscription) return
  workspaceRuntimeCloseSubscription = onWorkspaceRuntimeClosed((event) => {
    unregisterRepoWriteOperationBoundaryRepoId(event.workspaceId, event.workspaceRuntimeId)
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
  const ctrl = new AbortController()
  const onCallerAbort = () => {
    operation.requestCancel('caller-abort')
    ctrl.abort(callerSignal?.reason)
  }
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
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
  }
}

function createRepoWriteOperationContext(
  operation: RepoWriteOperationLifecycle,
  execution: RepoWriteExecutionCapability,
  callerSignal: AbortSignal | undefined,
): RepoWriteOperationContext {
  return {
    async runNetworkOperation(task) {
      return await runRepoWriteNetworkOperation(operation, task, callerSignal)
    },
    async runWithRepoSource<T extends ExecResult>(task: (source: RepoSource) => Promise<T>) {
      let valid: boolean
      try {
        valid = await validateRepoWriteExecution(execution, callerSignal)
      } catch (err) {
        if (!callerSignal?.aborted) throw err
        operation.requestCancel('caller-abort')
        const result = cancelledRepoWriteResult<T>()
        operation.settle(result)
        return result
      }
      if (!valid) {
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
  const runtimeRegistration = registerWorkspaceRuntime(repoId, operationInput.workspaceRuntimeId)
  let execution: RepoWriteExecutionCapability
  try {
    execution =
      operationInput.execution ??
      (await captureRepoWriteExecution(
        repoId,
        operationInput.workspaceRuntimeId ? { workspaceRuntimeId: operationInput.workspaceRuntimeId } : undefined,
        signal,
      ))
    assertWorkspaceRuntimeRegistrationActive(runtimeRegistration)
  } catch (err) {
    if (signal?.aborted) return cancelledRepoWriteResult()
    throw err
  }
  if (signal?.aborted) return cancelledRepoWriteResult()
  const group = bindRepoWriteBoundaryGroup(
    repoId,
    repoWriteExecutionBoundaryKey(execution),
    repoWriteExecutionCoordinationKey(execution),
  )
  const operation = beginRepoWriteOperation(group, operationInput)
  const context = createRepoWriteOperationContext(operation, execution, signal)
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
        assertWorkspaceRuntimeRegistrationActive(runtimeRegistration)
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
    const runtimeRegistration = registerWorkspaceRuntime(repoId, options.workspaceRuntimeId)
    const group = await resolveRepoWriteBoundaryGroup(repoId, options.signal, runtimeRegistration)
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
  options: { signal?: AbortSignal; workspaceRuntimeId?: string } = {},
): Promise<RepoWriteBoundaryHandle> {
  const runtimeRegistration = registerWorkspaceRuntime(repoId, options.workspaceRuntimeId)
  const group = await resolveRepoWriteBoundaryGroup(repoId, options.signal, runtimeRegistration)
  registerRepoWriteOperationBoundaryRepoId(group, repoId)
  return group
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
  queueByCoordinationDescriptor.clear()
  workspaceRuntimeRegistrationsByRepoId.clear()
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
  const queues = new Set(runtimes.map((runtime) => runtime.queue))
  return {
    boundaryRuntimes: runtimes.length,
    registeredBoundaries: boundaryGroupByDescriptor.size,
    registeredRepoIds: boundaryGroupByRepoId.size,
    queuedOperations: [...queues].reduce((total, queue) => total + queue.size, 0),
    runningOperations: [...queues].reduce((total, queue) => total + queue.pending, 0),
  }
}
