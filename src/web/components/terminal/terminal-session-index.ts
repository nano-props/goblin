export function syncTerminalSessionIdIndex(input: {
  key: string
  sessionId: string | null
  sessionIdByKey: Map<string, string>
  sessionKeyBySessionId: Map<string, string>
}): void {
  const previousSessionId = input.sessionIdByKey.get(input.key)
  if (
    previousSessionId &&
    previousSessionId !== input.sessionId &&
    input.sessionKeyBySessionId.get(previousSessionId) === input.key
  ) {
    input.sessionKeyBySessionId.delete(previousSessionId)
  }
  if (!input.sessionId) {
    input.sessionIdByKey.delete(input.key)
    return
  }
  input.sessionIdByKey.set(input.key, input.sessionId)
  input.sessionKeyBySessionId.set(input.sessionId, input.key)
}
