export async function abortableWorkspaceRestore<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await promise
  signal.throwIfAborted()
  let onAbort: (() => void) | null = null
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('workspace restore aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([promise, aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

export function workspaceDisplayName(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || value
}
