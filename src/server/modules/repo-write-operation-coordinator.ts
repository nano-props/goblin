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
import { isRepoMutationRuntimeFailureError } from '#/server/modules/repo-mutation-runtime-failure.ts'
import {
  isRemoteWorkspaceRuntimeFailure,
  type RemoteWorkspaceRuntimeFailureError,
} from '#/server/modules/remote-workspace-runtime-failure.ts'
import { onWorkspaceRuntimeClosed, onWorkspaceRuntimeFailed } from '#/server/modules/workspace-runtimes.ts'
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
import { RepoMembershipReadConflictError } from '#/server/modules/repo-membership-read-conflict.ts'
import { OperationCancelledError } from '#/shared/operation-cancelled.ts'

export interface RepoWriteOperationLifecycle {
  id: string
  start(): void
  requestCancel(reason: RepoOperationCancellationReason): void
  recordWaitCancellation(reason: RepoOperationCancellationReason): void
  runMembershipMutation<T>(mutation: () => Promise<T>): Promise<T>
  settle(result: { ok: boolean; message?: string; repoIdsToInvalidate?: readonly WorkspaceId[] }): void
}

export interface RepoWriteOperationContext {
  runNetworkOperation<T extends ExecResult>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
  runWithRepoSource<T extends ExecResult>(task: (source: RepoSource) => Promise<T>): Promise<T>
  runMembershipMutation<T>(mutation: () => Promise<T>): Promise<T>
}

interface BeginRepoWriteOperationInput {
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
  membershipRevision: number
  activeMembershipReads: number
  activeMembershipWrites: number
}

interface WorkspaceRuntimeBoundaryRegistration {
  readonly repoId: WorkspaceId
  readonly workspaceRuntimeId: string
  active: boolean
}

const MAX_SETTLED_OPERATIONS = 100

let nextWriteOperationId = 1
let nextSettledOperationOrdinal = 1
let nextBoundaryGroupId = 1
const boundaryGroups = new Set<RepoWriteBoundaryGroup>()
const boundaryGroupByRepoId = new Map<WorkspaceId, RepoWriteBoundaryGroup>()
const boundaryGroupByDescriptor = new Map<string, RepoWriteBoundaryGroup>()
const workspaceRuntimeRegistrationsByRepoId = new Map<WorkspaceId, Map<string, WorkspaceRuntimeBoundaryRegistration>>()
let boundaryGroupByHandle = new WeakMap<RepoWriteBoundaryHandle, RepoWriteBoundaryGroup>()
let settledOperationOrdinal = new WeakMap<RepoServerOperationState, number>()
let workspaceRuntimeCloseSubscription: (() => void) | null = null
let workspaceRuntimeFailureSubscription: (() => void) | null = null

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
    membershipRevision: 0,
    activeMembershipReads: 0,
    activeMembershipWrites: 0,
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
  const group = boundaryGroupByDescriptor.get(descriptor) ?? createBoundaryGroup(descriptor)
  registerRepoWriteOperationBoundaryRepoId(group, repoId)
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
      const timestampOrder = repoWriteOperationTimestamp(b.operation) - repoWriteOperationTimestamp(a.operation)
      if (timestampOrder !== 0) return timestampOrder
      return settledRepoWriteOperationOrdinal(b.operation) - settledRepoWriteOperationOrdinal(a.operation)
    })

  for (const { runtime, operation } of settled.slice(MAX_SETTLED_OPERATIONS)) {
    runtime.operations.delete(operation.id)
    publishRepoRuntimeInvalidation(runtime, operation)
    deleteBoundaryGroupIfIdle(runtime)
  }
}

function settledRepoWriteOperationOrdinal(operation: RepoServerOperationState): number {
  const ordinal = settledOperationOrdinal.get(operation)
  if (ordinal === undefined) throw new Error(`Repository write operation was not settled: ${operation.id}`)
  return ordinal
}

function beginRepoWriteOperation(
  runtime: RepoWriteBoundaryGroup,
  input: BeginRepoWriteOperationInput,
): RepoWriteOperationLifecycle {
  const now = Date.now()
  let settled = false
  const operation: RepoServerOperationState = {
    id: freshWriteOperationId(),
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
    async runMembershipMutation<T>(mutation: () => Promise<T>): Promise<T> {
      // This is an admission fence around the attempt to invoke a membership
      // mutation, not proof that a Git/SSH process started. A pre-spawn
      // cancellation may therefore advance the revision and make a concurrent
      // read fail once with a retryable conflict. That conservative fast-fail
      // is intentional: do not add revision rollback, invocation leases, or
      // client compensation merely to remove that harmless edge case.
      runtime.activeMembershipWrites += 1
      runtime.membershipRevision += 1
      const outcome = await observePromise(mutation)
      runtime.activeMembershipWrites -= 1
      runtime.membershipRevision += 1
      if (!outcome.ok) throw outcome.error
      return outcome.value
    },
    settle(result) {
      if (settled) return
      settled = true
      if (result.ok && operation.kind === 'fetch') recordRepoBoundaryFetchSuccess(runtime)
      const cancellationReason = operation.cancellation.reason
      operation.phase = result.ok ? 'done' : 'failed'
      operation.settledAt = Date.now()
      settledOperationOrdinal.set(operation, nextSettledOperationOrdinal++)
      operation.error = result.ok
        ? null
        : {
            message: result.message ?? 'error.failed-read-repo',
            reason: repoWriteOperationFailureReason(result.message, cancellationReason),
          }
      publishRepoRuntimeInvalidation(runtime, operation, result.repoIdsToInvalidate)
      pruneSettledOperations()
    },
  }
}

function publishRepoRuntimeInvalidation(
  runtime: RepoWriteBoundaryGroup,
  operation: Pick<RepoServerOperationState, 'repoId'>,
  additionalRepoIds: readonly WorkspaceId[] = [],
): void {
  const repoIds = new Set(runtime.repoIds)
  if (operation.repoId) repoIds.add(operation.repoId)
  for (const repoId of additionalRepoIds) repoIds.add(repoId)
  for (const repoId of repoIds) {
    publishRepoReadInvalidation({ repoId, domain: 'operations' })
  }
}

function registerRepoWriteOperationBoundaryRepoId(
  group: RepoWriteBoundaryGroup,
  repoId: WorkspaceId | null | undefined,
): void {
  ensureRepoRuntimeCloseSubscription()
  if (!repoId) return
  const previousGroup = boundaryGroupByRepoId.get(repoId)
  if (previousGroup === group) return
  const projectionChanged =
    boundaryGroupHasOperationProjection(group) ||
    (previousGroup !== undefined && boundaryGroupHasOperationProjection(previousGroup))
  if (previousGroup) {
    previousGroup.repoIds.delete(repoId)
    deleteBoundaryGroupIfIdle(previousGroup)
  }
  boundaryGroupByRepoId.set(repoId, group)
  group.repoIds.add(repoId)
  if (projectionChanged) publishRepoReadInvalidation({ repoId, domain: 'operations' })
}

function boundaryGroupHasOperationProjection(group: RepoWriteBoundaryGroup): boolean {
  return group.operations.size > 0 || group.lastSuccessfulFetchAt !== null
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
  if (group.repoIds.size > 0 || group.operations.size > 0 || group.activeMembershipReads > 0) return
  boundaryGroups.delete(group)
  if (boundaryGroupByDescriptor.get(group.descriptor) === group) boundaryGroupByDescriptor.delete(group.descriptor)
  boundaryGroupByHandle.delete(group)
}

function ensureRepoRuntimeCloseSubscription(): void {
  if (!workspaceRuntimeCloseSubscription) {
    workspaceRuntimeCloseSubscription = onWorkspaceRuntimeClosed((event) => {
      unregisterRepoWriteOperationBoundaryRepoId(event.workspaceId, event.workspaceRuntimeId)
    })
  }
  if (!workspaceRuntimeFailureSubscription) {
    workspaceRuntimeFailureSubscription = onWorkspaceRuntimeFailed((event) => {
      unregisterRepoWriteOperationBoundaryRepoId(event.workspaceId, event.workspaceRuntimeId)
    })
  }
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
  if (callerSignal?.aborted && isCancellationError(outcome.error, ctrl.signal)) {
    const result = cancelledRepoWriteResult<T>()
    operation.settle(result)
    return result
  }
  operation.settle(repoWriteOperationFailure(outcome.error))
  throw outcome.error
}

function repoWriteOperationFailure(error: unknown): {
  ok: false
  message: string
  repoIdsToInvalidate?: readonly WorkspaceId[]
} {
  if (isRepoMutationRuntimeFailureError(error)) {
    const failure = {
      ok: false as const,
      message: error.runtimeFailure.message,
    }
    return error.mutation.repoIdsToInvalidate
      ? { ...failure, repoIdsToInvalidate: error.mutation.repoIdsToInvalidate }
      : failure
  }
  return { ok: false, message: error instanceof Error ? error.message : String(error) }
}

function isCancellationError(error: unknown, signal: AbortSignal): boolean {
  if (error === signal.reason) return true
  if (error instanceof OperationCancelledError) return true
  return error instanceof Error && error.name === 'AbortError'
}

function createRepoWriteOperationContext(
  operation: RepoWriteOperationLifecycle,
  execution: RepoWriteExecutionCapability,
  runtimeRegistration: WorkspaceRuntimeBoundaryRegistration | null,
  callerSignal: AbortSignal | undefined,
): RepoWriteOperationContext {
  return {
    async runMembershipMutation<T>(mutation: () => Promise<T>): Promise<T> {
      return await operation.runMembershipMutation(mutation)
    },
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
  if (!capture.ok) {
    if (closeWorkspaceRuntimeAdmissionForFailure(runtimeRegistration, capture.error)) throw capture.error
    if (signal?.aborted) return cancelledRepoWriteResult()
    throw capture.error
  }
  if (signal?.aborted) return cancelledRepoWriteResult()
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
        closeWorkspaceRuntimeAdmissionForFailure(runtimeRegistration, err)
        operation.settle(repoWriteOperationFailure(err))
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
  options.signal?.throwIfAborted()
  const matchingGroups = repoId ? boundaryGroupsForRepoProjection(repoId) : [...boundaryGroups]
  return listBoundaryGroupOperations(matchingGroups, {
    includeSettled: options.includeSettled,
    workspaceRuntimeId: options.workspaceRuntimeId,
  })
}

export function getRepoLastSuccessfulFetchAt(repoId: WorkspaceId): number | null {
  return boundaryGroupByRepoId.get(repoId)?.lastSuccessfulFetchAt ?? null
}

function boundaryGroupsForRepoProjection(repoId: WorkspaceId): RepoWriteBoundaryGroup[] {
  const matchingGroups = new Set<RepoWriteBoundaryGroup>()
  const currentGroup = boundaryGroupByRepoId.get(repoId)
  if (currentGroup) matchingGroups.add(currentGroup)
  for (const group of boundaryGroups) {
    for (const operation of group.operations.values()) {
      if (operation.repoId !== repoId) continue
      matchingGroups.add(group)
      break
    }
  }
  return [...matchingGroups]
}

function closeWorkspaceRuntimeAdmissionForFailure(
  registration: WorkspaceRuntimeBoundaryRegistration | null,
  error: unknown,
): boolean {
  if (!registration) return false
  const runtimeFailure = remoteRuntimeFailureFromWriteError(error)
  if (!runtimeFailure) return false
  if (runtimeFailure.workspaceId !== registration.repoId) return false
  if (runtimeFailure.workspaceRuntimeId !== registration.workspaceRuntimeId) return false
  unregisterRepoWriteOperationBoundaryRepoId(registration.repoId, registration.workspaceRuntimeId)
  return true
}

function remoteRuntimeFailureFromWriteError(error: unknown): RemoteWorkspaceRuntimeFailureError | null {
  if (isRepoMutationRuntimeFailureError(error)) return error.runtimeFailure
  return isRemoteWorkspaceRuntimeFailure(error) ? error : null
}

function listBoundaryGroupOperations(
  groups: RepoWriteBoundaryGroup[],
  options: RepoWriteOperationListOptions,
): RepoServerOperationState[] {
  return projectRepoWriteOperations(
    groups.flatMap((group) => [...group.operations.values()]),
    options,
  )
}

export async function runWithRepoMembershipReadAdmission<T>(
  handle: RepoWriteBoundaryHandle,
  read: () => Promise<T>,
): Promise<T> {
  const group = boundaryGroupForHandle(handle)
  if (group.activeMembershipWrites > 0) throw new RepoMembershipReadConflictError()
  const revision = group.membershipRevision
  group.activeMembershipReads += 1
  try {
    const outcome = await observePromise(read)
    // The epoch gates acceptance of successful projection data. A failed read
    // keeps its own cancellation or typed runtime error so its lifecycle owner
    // can settle it. A may-have-run mutation invalidates the projection;
    // a conservative not-started conflict returns control through explicit retry.
    if (!outcome.ok) throw outcome.error
    assertRepoMembershipReadStillAdmitted(group, revision)
    return outcome.value
  } finally {
    group.activeMembershipReads -= 1
    deleteBoundaryGroupIfIdle(group)
  }
}

function assertRepoMembershipReadStillAdmitted(group: RepoWriteBoundaryGroup, revision: number): void {
  if (group.activeMembershipWrites > 0 || revision !== group.membershipRevision) {
    throw new RepoMembershipReadConflictError()
  }
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

export function resetRepoWriteOperationCoordinatorForTests(): void {
  boundaryGroups.clear()
  boundaryGroupByRepoId.clear()
  boundaryGroupByDescriptor.clear()
  workspaceRuntimeRegistrationsByRepoId.clear()
  boundaryGroupByHandle = new WeakMap()
  settledOperationOrdinal = new WeakMap()
  workspaceRuntimeCloseSubscription?.()
  workspaceRuntimeCloseSubscription = null
  workspaceRuntimeFailureSubscription?.()
  workspaceRuntimeFailureSubscription = null
  nextWriteOperationId = 1
  nextSettledOperationOrdinal = 1
  nextBoundaryGroupId = 1
}

export function repoWriteOperationCoordinatorStatsForTests(): {
  boundaryRuntimes: number
  registeredBoundaries: number
  registeredRepoIds: number
  queuedOperations: number
  runningOperations: number
} {
  const groups = [...boundaryGroups]
  const queues = new Set(groups.map((group) => group.queue))
  return {
    boundaryRuntimes: groups.length,
    registeredBoundaries: boundaryGroupByDescriptor.size,
    registeredRepoIds: boundaryGroupByRepoId.size,
    queuedOperations: [...queues].reduce((total, queue) => total + queue.size, 0),
    runningOperations: [...queues].reduce((total, queue) => total + queue.pending, 0),
  }
}
