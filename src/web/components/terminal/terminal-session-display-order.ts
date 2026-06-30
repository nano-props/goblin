import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'

export function terminalSessionDisplayOrder(
  descriptor: TerminalDescriptor,
  displayOrderByTerminalKey: ReadonlyMap<string, number>,
): number {
  return displayOrderByTerminalKey.get(descriptor.terminalKey) ?? descriptor.index - 1
}

export function sessionSnapshotDisplayOrder(
  orderedTerminalKeys: string[],
  displayOrderByTerminalKey: ReadonlyMap<string, number>,
): Map<string, number | undefined> {
  const previousOrder = new Map<string, number | undefined>()
  for (const terminalKey of orderedTerminalKeys)
    previousOrder.set(terminalKey, displayOrderByTerminalKey.get(terminalKey))
  return previousOrder
}

export function restoreSessionDisplayOrder(
  displayOrderByTerminalKey: Map<string, number>,
  previousOrder: ReadonlyMap<string, number | undefined>,
): void {
  for (const [terminalKey, order] of previousOrder) {
    if (order === undefined) displayOrderByTerminalKey.delete(terminalKey)
    else displayOrderByTerminalKey.set(terminalKey, order)
  }
}
