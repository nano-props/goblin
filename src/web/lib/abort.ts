export interface TimeoutAbortController {
  signal: AbortSignal
  abort: (reason?: unknown) => void
  dispose: () => void
}

export function createTimeoutAbortController(ms: number, message: string): TimeoutAbortController {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => {
    controller.abort(new Error(message))
  }, ms)
  return {
    signal: controller.signal,
    abort: (reason?: unknown) => controller.abort(reason),
    dispose: () => window.clearTimeout(timeout),
  }
}

/** Stop one caller from waiting without transferring its cancellation authority to shared work. */
export async function waitForPromiseWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  let onAbort: (() => void) | null = null
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([promise, aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}
