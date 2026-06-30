export function syncTerminalPtySessionIdIndex(input: {
  terminalKey: string
  ptySessionId: string | null
  ptySessionIdByTerminalKey: Map<string, string>
  terminalKeyByPtySessionId: Map<string, string>
}): void {
  const previousPtySessionId = input.ptySessionIdByTerminalKey.get(input.terminalKey)
  if (
    previousPtySessionId &&
    previousPtySessionId !== input.ptySessionId &&
    input.terminalKeyByPtySessionId.get(previousPtySessionId) === input.terminalKey
  ) {
    input.terminalKeyByPtySessionId.delete(previousPtySessionId)
  }
  if (!input.ptySessionId) {
    input.ptySessionIdByTerminalKey.delete(input.terminalKey)
    return
  }
  input.ptySessionIdByTerminalKey.set(input.terminalKey, input.ptySessionId)
  input.terminalKeyByPtySessionId.set(input.ptySessionId, input.terminalKey)
}
