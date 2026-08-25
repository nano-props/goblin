let commandTransportController = new AbortController()
const resetListeners = new Set<() => void>()

export function serverCommandTransportSignal(callerSignal?: AbortSignal): AbortSignal {
  if (!callerSignal) return commandTransportController.signal
  if (callerSignal.aborted) return callerSignal
  return AbortSignal.any([callerSignal, commandTransportController.signal])
}

export function resetServerCommandTransport(): void {
  const staleController = commandTransportController
  commandTransportController = new AbortController()
  staleController.abort(new Error('Server command transport reset after system resume'))
  for (const listener of resetListeners) listener()
}

export function subscribeServerCommandTransportReset(listener: () => void): () => void {
  resetListeners.add(listener)
  return () => {
    resetListeners.delete(listener)
  }
}
