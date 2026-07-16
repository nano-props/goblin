export function resolveAdjacentTerminalSelectionAfterRemoval(
  visibleTerminalSessionIdsBeforeRemoval: string[],
  removedTerminalSessionId: string,
): string | null {
  const removedIndex = visibleTerminalSessionIdsBeforeRemoval.indexOf(removedTerminalSessionId)
  if (removedIndex < 0) return visibleTerminalSessionIdsBeforeRemoval[0] ?? null
  const remaining = visibleTerminalSessionIdsBeforeRemoval.filter(
    (terminalSessionId) => terminalSessionId !== removedTerminalSessionId,
  )
  const right = remaining[removedIndex] ?? null
  const left = removedIndex >= 1 ? (remaining[removedIndex - 1] ?? null) : null
  return right ?? left ?? null
}
