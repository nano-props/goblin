export interface WebBootstrapOwner {
  readonly generation: number
  readonly signal: AbortSignal
  commit(action: () => void): boolean
  dispose(): void
}

export interface WebBootstrapDependencies {
  owner: WebBootstrapOwner
  timeoutMs: number
  hydrate: (signal: AbortSignal) => Promise<void>
  renderLoading: () => void
  renderError: (retry: () => void) => void
  renderApp: () => void
  logFailure: (error: unknown) => void
}

export function createWebBootstrapOwner(generation: number): WebBootstrapOwner {
  const controller = new AbortController()
  return {
    generation,
    signal: controller.signal,
    commit(action) {
      if (controller.signal.aborted) return false
      action()
      return true
    },
    dispose() {
      controller.abort(new Error(`Web bootstrap generation ${generation} was replaced`))
    },
  }
}

export function startWebBootstrap(dependencies: WebBootstrapDependencies): void {
  if (!dependencies.owner.commit(dependencies.renderLoading)) return
  void runWebBootstrap(dependencies)
}

async function runWebBootstrap(dependencies: WebBootstrapDependencies): Promise<void> {
  const timeout = createTimeoutController(dependencies.timeoutMs)
  const signal = AbortSignal.any([dependencies.owner.signal, timeout.signal])
  try {
    await dependencies.hydrate(signal)
  } catch (error) {
    timeout.abort(error)
    dependencies.owner.commit(() => {
      dependencies.logFailure(error)
      dependencies.renderError(() => startWebBootstrap(dependencies))
    })
    return
  } finally {
    timeout.dispose()
  }
  dependencies.owner.commit(dependencies.renderApp)
}

function createTimeoutController(ms: number): {
  signal: AbortSignal
  abort: (reason: unknown) => void
  dispose: () => void
} {
  const controller = new AbortController()
  const id = window.setTimeout(() => {
    controller.abort(new Error(`Initial public bootstrap timed out after ${ms}ms`))
  }, ms)
  return {
    signal: controller.signal,
    abort: (reason) => controller.abort(reason),
    dispose: () => window.clearTimeout(id),
  }
}
