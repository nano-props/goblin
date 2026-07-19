export interface ClientLocalEventMap {
  'terminal-bell-click': {
    type: 'terminal-bell-click'
    workspaceId: string
    terminalSessionId?: string
    terminalWorktreeKey?: string
  }
}

type ClientLocalEvent = ClientLocalEventMap[keyof ClientLocalEventMap]
type ClientLocalEventType = ClientLocalEvent['type']
type Listener = (event: ClientLocalEvent) => void

const listeners = new Set<Listener>()

export function emitClientLocalEvent<TType extends ClientLocalEventType>(event: ClientLocalEventMap[TType]): void {
  for (const listener of listeners) listener(event)
}

function onClientLocalEvent(cb: (event: ClientLocalEvent) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function onClientLocalEventType<TType extends ClientLocalEventType>(
  type: TType,
  cb: (event: ClientLocalEventMap[TType]) => void,
): () => void {
  return onClientLocalEvent((event) => {
    if (event.type === type) cb(event as ClientLocalEventMap[TType])
  })
}

export function resetClientLocalEventsForTests(): void {
  listeners.clear()
}
