export function resolveWebSocketProtocol(serverUrl: string): 'wss:' | 'ws:' {
  return new URL(serverUrl).protocol === 'https:' ? 'wss:' : 'ws:'
}

export function resolveApiBaseUrl(serverUrl: string): string {
  return serverUrl
}
