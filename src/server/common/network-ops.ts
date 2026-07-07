import type { ExecResult } from '#/shared/git-types.ts'
import type { NetworkOpKind, RepoServerOperationKind, RepoServerOperationTarget } from '#/shared/api-types.ts'
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
  operationId: string
  done: Promise<void>
  keys: string[]
}

interface RunServerCancellableOptions {
  operationId?: string
  gateId?: string
  operationKind?: RepoServerOperationKind
  target?: RepoServerOperationTarget | null
  repoInstanceId?: string | null
  deadlineAt?: number | null
  callerSignal?: AbortSignal
}

const activeNetworkOps = new Map<string, ActiveNetworkOp>()

async function waitForActiveNetworkOp(
  active: ActiveNetworkOp,
  callerSignal: AbortSignal | undefined,
  operationId: string,
): Promise<boolean> {
  if (!callerSignal) {
    await active.done
    return true
  }
  if (callerSignal.aborted) {
    recordRepoServerOperationWaitCancellation(operationId, 'caller-abort')
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
      recordRepoServerOperationWaitCancellation(operationId, 'caller-abort')
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
  const operation = beginRepoServerOperation({
    id: options.operationId,
    repoId,
    repoInstanceId: options.repoInstanceId,
    kind: options.operationKind ?? 'network',
    source: kind,
    target: options.target,
    deadlineAt: options.deadlineAt,
    canCancelUnderlying: true,
  })
  const operationGateId = options.gateId ?? repoId
  let active = activeNetworkOps.get(operationGateId)
  if (active) {
    if (kind === 'user' && active.kind === 'background') {
      const canContinue = await waitForActiveNetworkOp(active, options.callerSignal, operation.id)
      if (!canContinue) {
        const result = { ok: false, message: 'cancelled' }
        settleRepoServerOperation(operation.id, result)
        return result
      }
      active = activeNetworkOps.get(operationGateId)
    }
    if (active) {
      const result = { ok: false, message: 'error.network-op-in-progress' }
      settleRepoServerOperation(operation.id, result)
      return result
    }
  }
  const ctrl = new AbortController()
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  const keys = Array.from(new Set([operationGateId, repoId]))
  const slot: ActiveNetworkOp = { ctrl, kind, operationId: operation.id, done, keys }
  for (const key of keys) activeNetworkOps.set(key, slot)
  startRepoServerOperation(operation.id)
  try {
    const result = await fn(ctrl.signal)
    settleRepoServerOperation(operation.id, result)
    return result
  } catch (err) {
    settleRepoServerOperation(operation.id, {
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
  requestRepoServerOperationCancel(active.operationId, 'user-cancel')
  active.ctrl.abort()
  return true
}

export function abortServerNetworkOp(repoId: string): boolean {
  const active = activeNetworkOps.get(repoId)
  if (!active) return false
  requestRepoServerOperationCancel(active.operationId, 'user-cancel')
  active.ctrl.abort()
  return true
}
