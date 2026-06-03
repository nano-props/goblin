import type { ExecResult } from '#/shared/git-types.ts'
import type { NetworkOpKind } from '#/shared/rpc.ts'

interface ActiveNetworkOp {
  ctrl: AbortController
  kind: NetworkOpKind
  done: Promise<void>
}

const activeNetworkOps = new Map<string, ActiveNetworkOp>()

export async function runServerCancellable(
  repoId: string,
  kind: NetworkOpKind,
  fn: (signal: AbortSignal) => Promise<ExecResult>,
): Promise<ExecResult> {
  let active = activeNetworkOps.get(repoId)
  if (active) {
    if (kind === 'user' && active.kind === 'background') {
      await active.done
      active = activeNetworkOps.get(repoId)
    }
    if (active) return { ok: false, message: 'error.network-op-in-progress' }
  }
  const ctrl = new AbortController()
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  const slot: ActiveNetworkOp = { ctrl, kind, done }
  activeNetworkOps.set(repoId, slot)
  try {
    return await fn(ctrl.signal)
  } finally {
    if (activeNetworkOps.get(repoId) === slot) activeNetworkOps.delete(repoId)
    resolveDone()
  }
}

export function abortBackgroundServerNetworkOp(repoId: string): boolean {
  const active = activeNetworkOps.get(repoId)
  if (!active || active.kind !== 'background') return false
  active.ctrl.abort()
  return true
}

export function abortServerNetworkOp(repoId: string): boolean {
  const active = activeNetworkOps.get(repoId)
  if (!active) return false
  active.ctrl.abort()
  return true
}
