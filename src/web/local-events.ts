export interface RendererLocalEventMap {
  'terminal-bell-click': { type: 'terminal-bell-click'; repoRoot: string; key?: string }
}

type RendererLocalEvent = RendererLocalEventMap[keyof RendererLocalEventMap]
type RendererLocalEventType = RendererLocalEvent['type']
type Listener = (event: RendererLocalEvent) => void

const listeners = new Set<Listener>()

export function emitRendererLocalEvent<TType extends RendererLocalEventType>(
  event: RendererLocalEventMap[TType],
): void {
  for (const listener of listeners) listener(event)
}

export function onRendererLocalEvent(cb: (event: RendererLocalEvent) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function onRendererLocalEventType<TType extends RendererLocalEventType>(
  type: TType,
  cb: (event: RendererLocalEventMap[TType]) => void,
): () => void {
  return onRendererLocalEvent((event) => {
    if (event.type === type) cb(event as RendererLocalEventMap[TType])
  })
}

export function resetRendererLocalEventsForTests(): void {
  listeners.clear()
}
