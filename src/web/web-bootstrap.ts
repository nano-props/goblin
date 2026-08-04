export interface WebBootstrapAttempt {
  readonly signal: AbortSignal
  commit(action: () => void): boolean
}

export interface WebBootstrapOwner {
  readonly generation: number
  beginAttempt(): WebBootstrapAttempt | null
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
  const ownerController = new AbortController()
  let nextAttemptGeneration = 1
  let currentAttempt: { attempt: WebBootstrapAttempt; controller: AbortController } | null = null

  return {
    generation,
    beginAttempt() {
      if (ownerController.signal.aborted) return null

      const attemptGeneration = nextAttemptGeneration++
      currentAttempt?.controller.abort(
        new Error(`Web bootstrap generation ${generation} attempt ${attemptGeneration - 1} was replaced`),
      )

      const controller = new AbortController()
      const signal = AbortSignal.any([ownerController.signal, controller.signal])
      const attempt: WebBootstrapAttempt = {
        signal,
        commit(action) {
          if (signal.aborted || currentAttempt?.attempt !== attempt) return false
          action()
          return true
        },
      }
      currentAttempt = { attempt, controller }
      return attempt
    },
    dispose() {
      ownerController.abort(new Error(`Web bootstrap generation ${generation} was replaced`))
      currentAttempt = null
    },
  }
}

export function startWebBootstrap(dependencies: WebBootstrapDependencies): void {
  const attempt = dependencies.owner.beginAttempt()
  if (!attempt?.commit(dependencies.renderLoading)) return
  void runWebBootstrap(dependencies, attempt)
}

async function runWebBootstrap(dependencies: WebBootstrapDependencies, attempt: WebBootstrapAttempt): Promise<void> {
  const timeout = createTimeoutController(dependencies.timeoutMs)
  const signal = AbortSignal.any([attempt.signal, timeout.signal])
  try {
    await dependencies.hydrate(signal)
    signal.throwIfAborted()
  } catch (error) {
    timeout.abort(error)
    attempt.commit(() => {
      dependencies.logFailure(error)
      dependencies.renderError(() => startWebBootstrap(dependencies))
    })
    return
  } finally {
    timeout.dispose()
  }
  attempt.commit(dependencies.renderApp)
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
