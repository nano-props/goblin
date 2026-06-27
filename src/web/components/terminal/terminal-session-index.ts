export function syncTerminalPtySessionIdIndex(input: {
  key: string
  ptySessionId: string | null
  ptySessionIdByKey: Map<string, string>
  slotKeyByPtySessionId: Map<string, string>
}): void {
  const previousPtySessionId = input.ptySessionIdByKey.get(input.key)
  if (
    previousPtySessionId &&
    previousPtySessionId !== input.ptySessionId &&
    input.slotKeyByPtySessionId.get(previousPtySessionId) === input.key
  ) {
    input.slotKeyByPtySessionId.delete(previousPtySessionId)
  }
  if (!input.ptySessionId) {
    input.ptySessionIdByKey.delete(input.key)
    return
  }
  input.ptySessionIdByKey.set(input.key, input.ptySessionId)
  input.slotKeyByPtySessionId.set(input.ptySessionId, input.key)
}
