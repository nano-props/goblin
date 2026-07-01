export function syncTerminalPtySessionIdIndex(input: {
  terminalSessionId: string
  ptySessionId: string | null
  ptySessionIdByTerminalSessionId: Map<string, string>
  terminalSessionIdByPtySessionId: Map<string, string>
}): void {
  const previousPtySessionId = input.ptySessionIdByTerminalSessionId.get(input.terminalSessionId)
  if (
    previousPtySessionId &&
    previousPtySessionId !== input.ptySessionId &&
    input.terminalSessionIdByPtySessionId.get(previousPtySessionId) === input.terminalSessionId
  ) {
    input.terminalSessionIdByPtySessionId.delete(previousPtySessionId)
  }
  if (!input.ptySessionId) {
    input.ptySessionIdByTerminalSessionId.delete(input.terminalSessionId)
    return
  }
  input.ptySessionIdByTerminalSessionId.set(input.terminalSessionId, input.ptySessionId)
  input.terminalSessionIdByPtySessionId.set(input.ptySessionId, input.terminalSessionId)
}
