export interface IndexedTerminalRuntimeBinding {
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: number
}

export function syncTerminalRuntimeSessionIdIndex(input: {
  terminalSessionId: string
  terminalRuntimeBinding: IndexedTerminalRuntimeBinding | null
  terminalRuntimeBindingByTerminalSessionId: Map<string, IndexedTerminalRuntimeBinding>
  terminalSessionIdByTerminalRuntimeSessionId: Map<string, Map<number, string>>
}): void {
  const previousBinding = input.terminalRuntimeBindingByTerminalSessionId.get(input.terminalSessionId)
  if (previousBinding && !sameBinding(previousBinding, input.terminalRuntimeBinding)) {
    deleteReverseBinding(input, previousBinding)
  }
  if (!input.terminalRuntimeBinding) {
    input.terminalRuntimeBindingByTerminalSessionId.delete(input.terminalSessionId)
    return
  }
  input.terminalRuntimeBindingByTerminalSessionId.set(input.terminalSessionId, input.terminalRuntimeBinding)
  const byGeneration =
    input.terminalSessionIdByTerminalRuntimeSessionId.get(input.terminalRuntimeBinding.terminalRuntimeSessionId) ??
    new Map<number, string>()
  byGeneration.set(input.terminalRuntimeBinding.terminalRuntimeGeneration, input.terminalSessionId)
  input.terminalSessionIdByTerminalRuntimeSessionId.set(
    input.terminalRuntimeBinding.terminalRuntimeSessionId,
    byGeneration,
  )
}

function deleteReverseBinding(
  input: {
    terminalSessionId: string
    terminalSessionIdByTerminalRuntimeSessionId: Map<string, Map<number, string>>
  },
  binding: IndexedTerminalRuntimeBinding,
): void {
  const byGeneration = input.terminalSessionIdByTerminalRuntimeSessionId.get(binding.terminalRuntimeSessionId)
  if (byGeneration?.get(binding.terminalRuntimeGeneration) !== input.terminalSessionId) return
  byGeneration.delete(binding.terminalRuntimeGeneration)
  if (byGeneration.size === 0) input.terminalSessionIdByTerminalRuntimeSessionId.delete(binding.terminalRuntimeSessionId)
}

function sameBinding(a: IndexedTerminalRuntimeBinding, b: IndexedTerminalRuntimeBinding | null): boolean {
  return (
    b !== null &&
    a.terminalRuntimeSessionId === b.terminalRuntimeSessionId &&
    a.terminalRuntimeGeneration === b.terminalRuntimeGeneration
  )
}
