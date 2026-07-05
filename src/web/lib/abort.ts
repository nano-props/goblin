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
