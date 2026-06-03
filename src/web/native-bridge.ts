import type { RpcEvent, RpcRequest } from '#/shared/rpc.ts'
import { getRendererBridge } from '#/web/renderer-bridge.ts'

type NativeEventType = RpcEvent['type']

let nextNativeRequestId = 1

function createNativeRequestId(): string {
  return `rpc_${Date.now().toString(36)}_${nextNativeRequestId++}`
}

function abortNativeRequest(requestId: string): void {
  try {
    void Promise.resolve(getRendererBridge().abortRpc(requestId)).catch(() => {})
  } catch {}
}

async function invokeNativeRpc(request: RpcRequest, signal?: AbortSignal): Promise<unknown> {
  const requestId = request.requestId ?? createNativeRequestId()
  let aborted = false
  let cleanupAbort = () => {}
  let rejectAbort!: (reason?: unknown) => void
  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  const abort = () => {
    if (aborted) return
    aborted = true
    cleanupAbort()
    abortNativeRequest(requestId)
    rejectAbort(new Error('Request aborted'))
  }

  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true })
  cleanupAbort = () => signal?.removeEventListener('abort', abort)

  try {
    return await Promise.race([Promise.resolve(getRendererBridge().invokeRpc({ ...request, requestId })), abortPromise])
  } catch (cause) {
    throw cause instanceof Error ? cause : new Error(String(cause))
  } finally {
    cleanupAbort()
  }
}

export async function invokeNativeRpcPath<TOutput>(
  path: string,
  input: unknown,
  signal?: AbortSignal,
): Promise<TOutput> {
  return (await invokeNativeRpc({ path, input, requestId: createNativeRequestId() }, signal)) as TOutput
}

export function onNativeEventType<TType extends NativeEventType>(
  type: TType,
  cb: (event: Extract<RpcEvent, { type: TType }>) => void,
): () => void {
  return getRendererBridge().onRpcEvent((event) => {
    if (event.type === type) cb(event as Extract<RpcEvent, { type: TType }>)
  })
}
