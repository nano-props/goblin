import type { ExecResult } from '#/shared/git-types.ts'
import type {
  NetworkOpKind,
  RepoOperationCancellationReason,
  RepoServerOperationKind,
  RepoServerOperationTarget,
} from '#/shared/api-types.ts'
import {
  beginRepoServerOperation,
  recordRepoServerOperationWaitCancellation,
  requestRepoServerOperationCancel,
  settleRepoServerOperation,
  startRepoServerOperation,
} from '#/server/modules/repo-operation-registry.ts'

interface ActiveNetworkOp {
  ctrl: AbortController
  kind: NetworkOpKind
  operation: ServerOperationLifecycle
  done: Promise<void>
  keys: NetworkOpKey[]
}

export interface ServerOperationLifecycle {
  id: string
  start(): void
  requestCancel(reason: RepoOperationCancellationReason): void
  recordWaitCancellation(reason: RepoOperationCancellationReason): void
  settle(result: { ok: boolean; message?: string }): void
}

interface RunServerCancellableOptions {
  operation?: ServerOperationLifecycle
  activeKey?: object
  operationKind?: RepoServerOperationKind
  target?: RepoServerOperationTarget | null
  repoInstanceId?: string | null
  deadlineAt?: number | null
  callerSignal?: AbortSignal
}

type NetworkOpKey = string | object

const activeNetworkOps = new Map<NetworkOpKey, ActiveNetworkOp>()

function beginRegistryOperation(
  repoId: string,
  kind: NetworkOpKind,
  options: RunServerCancellableOptions,
): ServerOperationLifecycle {
  const operation = beginRepoServerOperation({
    repoId,
    repoInstanceId: options.repoInstanceId,
    kind: options.operationKind ?? 'network',
    source: kind,
    target: options.target,
    deadlineAt: options.deadlineAt,
    canCancelUnderlying: true,
  })
  return {
    id: operation.id,
    start() {
      startRepoServerOperation(operation.id)
    },
    requestCancel(reason) {
      requestRepoServerOperationCancel(operation.id, reason)
    },
    recordWaitCancellation(reason) {
      recordRepoServerOperationWaitCancellation(operation.id, reason)
    },
    settle(result) {
      settleRepoServerOperation(operation.id, result)
    },
  }
}

async function waitForActiveNetworkOp(
  active: ActiveNetworkOp,
  callerSignal: AbortSignal | undefined,
  operation: ServerOperationLifecycle,
): Promise<boolean> {
  if (!callerSignal) {
    await active.done
    return true
  }
  if (callerSignal.aborted) {
    operation.recordWaitCancellation('caller-abort')
    return false
  }
  return await new Promise<boolean>((resolve) => {
    let settled = false
    const cleanup = () => callerSignal.removeEventListener('abort', abort)
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const abort = () => {
      operation.recordWaitCancellation('caller-abort')
      finish(false)
    }
    callerSignal.addEventListener('abort', abort, { once: true })
    active.done.then(
      () => finish(true),
      () => finish(true),
    )
  })
}

export async function runServerCancellable(
  repoId: string,
  kind: NetworkOpKind,
  fn: (signal: AbortSignal) => Promise<ExecResult>,
  options: RunServerCancellableOptions = {},
): Promise<ExecResult> {
  const operation = options.operation ?? beginRegistryOperation(repoId, kind, options)
  const activeOperationKey = options.activeKey ?? repoId
  let active = activeNetworkOps.get(activeOperationKey)
  if (active) {
    if (kind === 'user' && active.kind === 'background') {
      const canContinue = await waitForActiveNetworkOp(active, options.callerSignal, operation)
      if (!canContinue) {
        const result = { ok: false, message: 'cancelled' }
        operation.settle(result)
        return result
      }
      active = activeNetworkOps.get(activeOperationKey)
    }
    if (active) {
      const result = { ok: false, message: 'error.network-op-in-progress' }
      operation.settle(result)
      return result
    }
  }
  const ctrl = new AbortController()
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  const keys = Array.from(new Set([activeOperationKey, repoId]))
  const slot: ActiveNetworkOp = { ctrl, kind, operation, done, keys }
  for (const key of keys) activeNetworkOps.set(key, slot)
  operation.start()
  try {
    const result = await fn(ctrl.signal)
    operation.settle(result)
    return result
  } catch (err) {
    operation.settle({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    })
    throw err
  } finally {
    for (const key of slot.keys) {
      if (activeNetworkOps.get(key) === slot) activeNetworkOps.delete(key)
    }
    resolveDone()
  }
}

export function abortBackgroundServerNetworkOp(repoId: string): boolean {
  const active = activeNetworkOps.get(repoId)
  if (!active || active.kind !== 'background') return false
  active.operation.requestCancel('user-cancel')
  active.ctrl.abort()
  return true
}

export function abortServerNetworkOp(repoId: string): boolean {
  return abortServerNetworkOpByKey(repoId)
}

export function abortServerNetworkOpByKey(key: NetworkOpKey): boolean {
  const active = activeNetworkOps.get(key)
  if (!active) return false
  active.operation.requestCancel('user-cancel')
  active.ctrl.abort()
  return true
}
