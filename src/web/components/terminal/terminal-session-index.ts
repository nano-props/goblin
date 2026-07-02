export function syncTerminalRuntimeSessionIdIndex(input: {
  terminalSessionId: string
  terminalRuntimeSessionId: string | null
  terminalRuntimeSessionIdByTerminalSessionId: Map<string, string>
  terminalSessionIdByTerminalRuntimeSessionId: Map<string, string>
}): void {
  const previousTerminalRuntimeSessionId = input.terminalRuntimeSessionIdByTerminalSessionId.get(input.terminalSessionId)
  if (
    previousTerminalRuntimeSessionId &&
    previousTerminalRuntimeSessionId !== input.terminalRuntimeSessionId &&
    input.terminalSessionIdByTerminalRuntimeSessionId.get(previousTerminalRuntimeSessionId) === input.terminalSessionId
  ) {
    input.terminalSessionIdByTerminalRuntimeSessionId.delete(previousTerminalRuntimeSessionId)
  }
  if (!input.terminalRuntimeSessionId) {
    input.terminalRuntimeSessionIdByTerminalSessionId.delete(input.terminalSessionId)
    return
  }
  input.terminalRuntimeSessionIdByTerminalSessionId.set(input.terminalSessionId, input.terminalRuntimeSessionId)
  input.terminalSessionIdByTerminalRuntimeSessionId.set(input.terminalRuntimeSessionId, input.terminalSessionId)
}
