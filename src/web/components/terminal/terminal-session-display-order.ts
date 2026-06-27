import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'

export function terminalSessionDisplayOrder(
  descriptor: TerminalDescriptor,
  displayOrderByKey: ReadonlyMap<string, number>,
): number {
  return displayOrderByKey.get(descriptor.key) ?? descriptor.index - 1
}

export function sessionSnapshotDisplayOrder(
  orderedKeys: string[],
  displayOrderByKey: ReadonlyMap<string, number>,
): Map<string, number | undefined> {
  const previousOrder = new Map<string, number | undefined>()
  for (const key of orderedKeys) previousOrder.set(key, displayOrderByKey.get(key))
  return previousOrder
}

export function restoreSessionDisplayOrder(
  displayOrderByKey: Map<string, number>,
  previousOrder: ReadonlyMap<string, number | undefined>,
): void {
  for (const [key, order] of previousOrder) {
    if (order === undefined) displayOrderByKey.delete(key)
    else displayOrderByKey.set(key, order)
  }
}
