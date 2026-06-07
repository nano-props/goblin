export function resolveWebSocketProtocol(): 'wss:' | 'ws:' {
  if (typeof window !== 'undefined' && window.location?.protocol === 'https:') {
    return 'wss:'
  }
  return 'ws:'
}

export function resolveApiBaseUrl(serverUrl: string): string {
  if (typeof window !== 'undefined' && window.location) {
    const proto = window.location.protocol
    if (proto === 'https:' || proto === 'http:') {
      return window.location.origin
    }
  }
  return serverUrl
}
