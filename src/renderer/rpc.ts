import { createTRPCClient, TRPCClientError, type TRPCLink } from '@trpc/client'
import { observable } from '@trpc/server/observable'
import type { AppRouter, RpcEvent } from '#/shared/rpc.ts'

type RpcEventType = RpcEvent['type']

function getGoblinBridge(): Window['goblin'] {
  const bridge = window.goblin
  if (!bridge) throw new Error('Goblin bridge is unavailable')
  return bridge
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
      const abort = () => {
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
        request = Promise.resolve(getGoblinBridge().invokeRpc({ path: op.path, input: op.input }))
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
