export function syncTerminalSessionIdIndex(input: {
  key: string
  ptySessionId: string | null
  sessionIdByKey: Map<string, string>
  slotKeyByPtySessionId: Map<string, string>
}): void {
  const previousSessionId = input.sessionIdByKey.get(input.key)
  if (
    previousSessionId &&
    previousSessionId !== input.ptySessionId &&
    input.slotKeyByPtySessionId.get(previousSessionId) === input.key
  ) {
    input.slotKeyByPtySessionId.delete(previousSessionId)
  }
  if (!input.ptySessionId) {
    input.sessionIdByKey.delete(input.key)
    return
  }
  input.sessionIdByKey.set(input.key, input.ptySessionId)
  input.slotKeyByPtySessionId.set(input.ptySessionId, input.key)
}
