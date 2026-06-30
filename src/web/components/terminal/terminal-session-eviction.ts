export function countOrphanedTerminalSessionIds(input: {
  repoRoot: string
  localTerminalSessionIds: string[]
  getRepoRootForTerminalSessionId: (terminalSessionId: string) => string | null
  hasPtySessionIdForTerminalSessionId: (terminalSessionId: string) => boolean
  serverTerminalSessionIds: ReadonlySet<string>
}): string[] {
  const orphanedTerminalSessionIds: string[] = []
  for (const terminalSessionId of input.localTerminalSessionIds) {
    if (input.getRepoRootForTerminalSessionId(terminalSessionId) !== input.repoRoot) continue
    if (input.serverTerminalSessionIds.has(terminalSessionId)) continue
    if (!input.hasPtySessionIdForTerminalSessionId(terminalSessionId)) continue
    orphanedTerminalSessionIds.push(terminalSessionId)
  }
  return orphanedTerminalSessionIds
}

export function resolveAdjacentTerminalSelectionAfterRemoval(
  orderedTerminalSessionIdsBeforeRemoval: string[],
  removedTerminalSessionId: string,
): string | null {
  const closedOrderIndex = orderedTerminalSessionIdsBeforeRemoval.indexOf(removedTerminalSessionId)
  if (closedOrderIndex < 0) return orderedTerminalSessionIdsBeforeRemoval[0] ?? null
  const remaining = orderedTerminalSessionIdsBeforeRemoval.filter(
    (terminalSessionId) => terminalSessionId !== removedTerminalSessionId,
  )
  const right = remaining[closedOrderIndex] ?? null
  const left = closedOrderIndex >= 1 ? (remaining[closedOrderIndex - 1] ?? null) : null
  return right ?? left ?? null
}
