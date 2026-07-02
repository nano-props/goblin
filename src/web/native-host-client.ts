import type { NativeHostIpcPath, IpcRequest } from '#/shared/api-types.ts'
import { createOpaqueId } from '#/shared/opaque-id.ts'
import { getClientBridge } from '#/web/client-bridge.ts'

function createNativeRequestId(): string {
  return createOpaqueId('ipc')
}

function abortNativeRequest(requestId: string): void {
  try {
    void Promise.resolve(getClientBridge().abortIpc(requestId)).catch(() => {})
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
    return await Promise.race([Promise.resolve(getClientBridge().invokeIpc({ ...request, requestId })), abortPromise])
  } catch (cause) {
    throw cause instanceof Error ? cause : new Error(String(cause))
  } finally {
    cleanupAbort()
  }
}

export async function invokeNativeIpcPath<TOutput>(
  path: NativeHostIpcPath,
  input: unknown,
  signal?: AbortSignal,
): Promise<TOutput> {
  return (await invokeNativeIpc({ path, input, requestId: createNativeRequestId() }, signal)) as TOutput
}
