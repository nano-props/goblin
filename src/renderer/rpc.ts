import { createTRPCClient, TRPCClientError, type TRPCLink } from '@trpc/client'
import { observable } from '@trpc/server/observable'
import type { AppRouter, RpcEvent } from '#/shared/rpc.ts'

type RpcEventType = RpcEvent['type']

const ABORTABLE_REPO_CWD_PATHS = new Set([
  'repo.fetch',
  'repo.pull',
  'repo.push',
  'repo.checkout',
  'repo.createWorktree',
  'repo.deleteBranch',
  'repo.removeWorktree',
])

let nextRpcRequestId = 1

function createRpcRequestId(): string {
  return `rpc_${Date.now().toString(36)}_${nextRpcRequestId++}`
}

function getGoblinBridge(): Window['goblin'] {
  const bridge = window.goblin
  if (!bridge) throw new Error('Goblin bridge is unavailable')
  return bridge
}

function abortableRepoCwd(path: string, input: unknown): string | null {
  if (!ABORTABLE_REPO_CWD_PATHS.has(path)) return null
  if (!input || typeof input !== 'object') return null
  const { cwd } = input as { cwd?: unknown }
  return typeof cwd === 'string' ? cwd : null
}

function invokeRepoAbort(cwd: string): void {
  try {
    void Promise.resolve(getGoblinBridge().invokeRpc({ path: 'repo.abort', input: { cwd } })).catch(() => {})
  } catch {}
}

function invokeRpcAbort(requestId: string): void {
  try {
    void Promise.resolve(getGoblinBridge().abortRpc(requestId)).catch(() => {})
  } catch {}
}

const ipcLink: TRPCLink<AppRouter> = () => {
  return ({ op }) => {
    return observable((observer) => {
      if (op.type === 'subscription') {
        observer.error(TRPCClientError.from(new Error('Subscriptions are not supported over Electron IPC')))
        return () => {}
      }

      let active = true
      let cleanupAbort = () => {}
      const finish = () => {
        active = false
        cleanupAbort()
      }
      const fail = (cause: unknown) => {
        if (!active) return
        finish()
        observer.error(TRPCClientError.from(cause instanceof Error ? cause : new Error(String(cause))))
      }
      const requestId = createRpcRequestId()
      const abort = () => {
        const cwd = abortableRepoCwd(op.path, op.input)
        if (cwd) invokeRepoAbort(cwd)
        invokeRpcAbort(requestId)
        fail(new Error('Request aborted'))
      }

      if (op.signal?.aborted) {
        abort()
        return () => {}
      }

      op.signal?.addEventListener('abort', abort, { once: true })
      cleanupAbort = () => op.signal?.removeEventListener('abort', abort)

      let request: Promise<unknown>
      try {
        request = Promise.resolve(getGoblinBridge().invokeRpc({ path: op.path, input: op.input, requestId }))
      } catch (cause) {
        fail(cause)
        return () => {}
      }

      request
        .then((data) => {
          if (!active) return
          finish()
          observer.next({ result: { data } })
          observer.complete()
        })
        .catch(fail)

      return () => {
        if (active) finish()
      }
    })
  }
}

export const rpc = createTRPCClient<AppRouter>({
  links: [ipcLink],
})

export const goblin = {
  get homeDir() {
    return getGoblinBridge().homeDir
  },
  pathForFile(file: File) {
    return getGoblinBridge().pathForFile(file)
  },
}

export function onRpcEvent(cb: (event: RpcEvent) => void): () => void {
  return getGoblinBridge().onEvent(cb)
}

export function onRpcEventType<TType extends RpcEventType>(
  type: TType,
  cb: (event: Extract<RpcEvent, { type: TType }>) => void,
): () => void {
  return onRpcEvent((event) => {
    if (event.type === type) cb(event as Extract<RpcEvent, { type: TType }>)
  })
}
