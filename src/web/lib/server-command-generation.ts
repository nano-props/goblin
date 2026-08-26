let serverCommandGenerationController = new AbortController()
const generationAdvanceListeners = new Set<() => void>()

export function composeServerCommandGenerationSignal(callerSignal?: AbortSignal): AbortSignal {
  if (!callerSignal) return serverCommandGenerationController.signal
  if (callerSignal.aborted) return callerSignal
  return AbortSignal.any([callerSignal, serverCommandGenerationController.signal])
}

export function advanceServerCommandGeneration(): void {
  const staleController = serverCommandGenerationController
  serverCommandGenerationController = new AbortController()
  staleController.abort(new Error('Server command generation superseded'))
  for (const listener of generationAdvanceListeners) listener()
}

export function subscribeServerCommandGenerationAdvance(listener: () => void): () => void {
  generationAdvanceListeners.add(listener)
  return () => {
    generationAdvanceListeners.delete(listener)
  }
}
