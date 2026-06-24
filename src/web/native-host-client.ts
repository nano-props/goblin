import type { NativeIpcPath, IpcRequest } from '#/shared/api-types.ts'
import { getRendererBridge } from '#/web/client-bridge.ts'

let nextNativeRequestId = 1

function createNativeRequestId(): string {
  return `ipc_${Date.now().toString(36)}_${nextNativeRequestId++}`
}

function abortNativeRequest(requestId: string): void {
  try {
    void Promise.resolve(getRendererBridge().abortIpc(requestId)).catch(() => {})
  } catch {}
}

async function invokeNativeIpc(request: IpcRequest, signal?: AbortSignal): Promise<unknown> {
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
    return await Promise.race([Promise.resolve(getRendererBridge().invokeIpc({ ...request, requestId })), abortPromise])
  } catch (cause) {
    throw cause instanceof Error ? cause : new Error(String(cause))
  } finally {
    cleanupAbort()
  }
}

export async function invokeNativeIpcPath<TOutput>(
  path: NativeIpcPath,
  input: unknown,
  signal?: AbortSignal,
): Promise<TOutput> {
  return (await invokeNativeIpc({ path, input, requestId: createNativeRequestId() }, signal)) as TOutput
}
