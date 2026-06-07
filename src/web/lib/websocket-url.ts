export function resolveWebSocketProtocol(): 'wss:' | 'ws:' {
  if (typeof window !== 'undefined' && window.location?.protocol === 'https:') {
    return 'wss:'
  }
  return 'ws:'
}
