export function countOrphanedTerminalSessionKeys(input: {
  repoRoot: string
  localSlotKeys: string[]
  getRepoRootForKey: (key: string) => string | null
  hasServerPtySessionId: (key: string) => boolean
  serverKeys: ReadonlySet<string>
}): string[] {
  const orphanedKeys: string[] = []
  for (const key of input.localSlotKeys) {
    if (input.getRepoRootForKey(key) !== input.repoRoot) continue
    if (input.serverKeys.has(key)) continue
    if (!input.hasServerPtySessionId(key)) continue
    orphanedKeys.push(key)
  }
  return orphanedKeys
}

export function resolveAdjacentTerminalSelectionAfterRemoval(
  orderedKeysBeforeRemoval: string[],
  removedKey: string,
): string | null {
  const closedOrderIndex = orderedKeysBeforeRemoval.indexOf(removedKey)
  if (closedOrderIndex < 0) return orderedKeysBeforeRemoval[0] ?? null
  const remaining = orderedKeysBeforeRemoval.filter((key) => key !== removedKey)
  const right = remaining[closedOrderIndex] ?? null
  const left = closedOrderIndex >= 1 ? (remaining[closedOrderIndex - 1] ?? null) : null
  return right ?? left ?? null
}
