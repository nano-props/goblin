import PQueue from 'p-queue'
import {
  captureRepoWriteExecution,
  repoWriteExecutionBoundaryKey,
  runWithCapturedRepoWriteExecution,
  type RepoSource,
  type RepoWriteExecutionCapability,
} from '#/server/modules/repo-source.ts'
import { resolveRepoWriteBoundaryKey } from '#/server/modules/repo-write-boundary.ts'
import { publishRepoReadInvalidation } from '#/server/modules/invalidation-broker.ts'
import { onWorkspaceRuntimeClosed } from '#/server/modules/workspace-runtimes.ts'
import type {
  RepoOperationCancellationReason,
  RepoServerOperationKind,
  RepoServerOperationSource,
  RepoServerOperationState,
  RepoServerOperationTarget,
} from '#/shared/api-types.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { WorkspaceRuntimeAdmissionClosedError } from '#/server/modules/workspace-runtime-admission-error.ts'
import {
  isSettledRepoWriteOperation,
  projectRepoWriteOperations,
  repoWriteOperationFailureReason,
  repoWriteOperationTimestamp,
  type RepoWriteOperationListOptions,
} from '#/server/modules/repo-write-operation-state.ts'

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
  captureExecution?: (signal?: AbortSignal) => Promise<RepoWriteExecutionCapability>
}

export interface RepoWriteBoundaryHandle {
  readonly id: string
}

interface RepoWriteBoundaryGroup extends RepoWriteBoundaryHandle {
  readonly descriptor: string
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
const workspaceRuntimeRegistrationsByRepoId = new Map<WorkspaceId, Map<string, WorkspaceRuntimeBoundaryRegistration>>()
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
  const boundaryKey = await resolveRepoWriteBoundaryKey(repoId, signal)
  assertWorkspaceRuntimeRegistrationActive(runtimeRegistration)
  return bindRepoWriteBoundaryGroup(repoId, boundaryKey)
}

function bindRepoWriteBoundaryGroup(repoId: WorkspaceId, descriptor: string): RepoWriteBoundaryGroup {
  ensureRepoRuntimeCloseSubscription()
  const previousGroup = boundaryGroupByRepoId.get(repoId)
  const group = boundaryGroupByDescriptor.get(descriptor) ?? createBoundaryGroup(descriptor)
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
  const error = workspaceRuntimeRegistrationClosedError(registration)
  if (error) throw error
}

function workspaceRuntimeRegistrationClosedError(
  registration: WorkspaceRuntimeBoundaryRegistration | null | undefined,
): WorkspaceRuntimeAdmissionClosedError | null {
  return registration && !registration.active ? new WorkspaceRuntimeAdmissionClosedError() : null
}

function pruneSettledOperations(): void {
  const settled = [...boundaryGroups]
    .flatMap((runtime) =>
      [...runtime.operations.values()].filter(isSettledRepoWriteOperation).map((operation) => ({ runtime, operation })),
    )
    .sort((a, b) => {
      return repoWriteOperationTimestamp(b.operation) - repoWriteOperationTimestamp(a.operation)
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
      if (operation.cancellation.underlyingRequested) return
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
            reason: repoWriteOperationFailureReason(result.message, cancellationReason),
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
    publishRepoReadInvalidation({ repoId, domain: 'operations' })
  }
}

function registerRepoWriteOperationBoundaryRepoId(
  group: RepoWriteBoundaryGroup,
  repoId: WorkspaceId | null | undefined,
): void {
  ensureRepoRuntimeCloseSubscription()
  if (repoId) {
    boundaryGroupByRepoId.set(repoId, group)
    group.repoIds.add(repoId)
  }
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

type PromiseOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown }

function observePromise<T>(run: () => Promise<T>): Promise<PromiseOutcome<T>> {
  return new Promise<T>((resolve) => resolve(run())).then<PromiseOutcome<T>, PromiseOutcome<T>>(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  )
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

  const outcome = await observePromise(
    async () =>
      await group.queue.add(
        async () => {
          started = true
          callerSignal?.removeEventListener('abort', cancelQueuedOperation)
          return await task()
        },
        queuedAbortCtrl ? { signal: queuedAbortCtrl.signal } : undefined,
      ),
  )
  callerSignal?.removeEventListener('abort', cancelQueuedOperation)
  if (outcome.ok) return outcome.value
  if (queuedCancelled) return cancelledRepoWriteResult()
  throw outcome.error
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
  const outcome = await observePromise(async () => await task(ctrl.signal))
  callerSignal?.removeEventListener('abort', onCallerAbort)

  if (outcome.ok) {
    operation.settle(outcome.value)
    return outcome.value
  }
  if (callerSignal?.aborted) {
    const result = cancelledRepoWriteResult<T>()
    operation.settle(result)
    return result
  }
  operation.settle({
    ok: false,
    message: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
  })
  throw outcome.error
}

function createRepoWriteOperationContext(
  operation: RepoWriteOperationLifecycle,
  execution: RepoWriteExecutionCapability,
  runtimeRegistration: WorkspaceRuntimeBoundaryRegistration | null,
  callerSignal: AbortSignal | undefined,
): RepoWriteOperationContext {
  return {
    async runNetworkOperation(task) {
      return await runRepoWriteNetworkOperation(operation, task, callerSignal)
    },
    async runWithRepoSource<T extends ExecResult>(task: (source: RepoSource) => Promise<T>) {
      const admissionError = workspaceRuntimeRegistrationClosedError(runtimeRegistration)
      if (admissionError) {
        operation.settle({ ok: false, message: admissionError.message })
        throw admissionError
      }
      if (callerSignal?.aborted) {
        operation.requestCancel('caller-abort')
        const result = cancelledRepoWriteResult<T>()
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
  const capture = await observePromise(async () =>
    operationInput.captureExecution
      ? await operationInput.captureExecution(signal)
      : await captureRepoWriteExecution(
          repoId,
          operationInput.workspaceRuntimeId ? { workspaceRuntimeId: operationInput.workspaceRuntimeId } : undefined,
          signal,
        ),
  )
  assertWorkspaceRuntimeRegistrationActive(runtimeRegistration)
  if (signal?.aborted) return cancelledRepoWriteResult()
  if (!capture.ok) throw capture.error
  const execution = capture.value
  const group = bindRepoWriteBoundaryGroup(repoId, repoWriteExecutionBoundaryKey(execution))
  const operation = beginRepoWriteOperation(group, operationInput)
  const context = createRepoWriteOperationContext(operation, execution, runtimeRegistration, signal)
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
      const admissionError = workspaceRuntimeRegistrationClosedError(runtimeRegistration)
      if (admissionError) {
        operation.settle({ ok: false, message: admissionError.message })
        throw admissionError
      }
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
  options: RepoWriteOperationListOptions,
): RepoServerOperationState[] {
  return projectRepoWriteOperations(
    runtimes.flatMap((runtime) => [...runtime.operations.values()]),
    options,
  )
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
