export function countOrphanedTerminalSessionIds(input: {
  repoRoot: string
  localTerminalSessionIds: string[]
  getRepoRootForTerminalSessionId: (terminalSessionId: string) => string | null
  hasTerminalRuntimeSessionIdForTerminalSessionId: (terminalSessionId: string) => boolean
  serverTerminalSessionIds: ReadonlySet<string>
}): string[] {
  const orphanedTerminalSessionIds: string[] = []
  for (const terminalSessionId of input.localTerminalSessionIds) {
    if (input.getRepoRootForTerminalSessionId(terminalSessionId) !== input.repoRoot) continue
    if (input.serverTerminalSessionIds.has(terminalSessionId)) continue
    if (!input.hasTerminalRuntimeSessionIdForTerminalSessionId(terminalSessionId)) continue
    orphanedTerminalSessionIds.push(terminalSessionId)
  }
  return orphanedTerminalSessionIds
}

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
