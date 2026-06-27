export function syncTerminalPtySessionIdIndex(input: {
  key: string
  ptySessionId: string | null
  ptySessionIdByKey: Map<string, string>
  sessionKeyByPtySessionId: Map<string, string>
}): void {
  const previousPtySessionId = input.ptySessionIdByKey.get(input.key)
  if (
    previousPtySessionId &&
    previousPtySessionId !== input.ptySessionId &&
    input.sessionKeyByPtySessionId.get(previousPtySessionId) === input.key
  ) {
    input.sessionKeyByPtySessionId.delete(previousPtySessionId)
  }
  if (!input.ptySessionId) {
    input.ptySessionIdByKey.delete(input.key)
    return
  }
  input.ptySessionIdByKey.set(input.key, input.ptySessionId)
  input.sessionKeyByPtySessionId.set(input.ptySessionId, input.key)
}
