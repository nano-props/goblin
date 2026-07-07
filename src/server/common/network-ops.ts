import type { ExecResult } from '#/shared/git-types.ts'
import type { NetworkOpKind, RepoServerOperationKind, RepoServerOperationTarget } from '#/shared/api-types.ts'
import {
  beginRepoServerOperation,
  requestRepoServerOperationCancel,
  settleRepoServerOperation,
  startRepoServerOperation,
} from '#/server/modules/repo-operation-registry.ts'

interface ActiveNetworkOp {
  ctrl: AbortController
  kind: NetworkOpKind
  operationId: string
  done: Promise<void>
}

interface RunServerCancellableOptions {
  operationId?: string
  operationKind?: RepoServerOperationKind
  target?: RepoServerOperationTarget | null
  repoInstanceId?: string | null
  deadlineAt?: number | null
}

const activeNetworkOps = new Map<string, ActiveNetworkOp>()

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
  let active = activeNetworkOps.get(repoId)
  if (active) {
    if (kind === 'user' && active.kind === 'background') {
      await active.done
      active = activeNetworkOps.get(repoId)
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
  const slot: ActiveNetworkOp = { ctrl, kind, operationId: operation.id, done }
  activeNetworkOps.set(repoId, slot)
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
    if (activeNetworkOps.get(repoId) === slot) activeNetworkOps.delete(repoId)
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
