import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'

export function terminalSessionDisplayOrder(
  descriptor: TerminalDescriptor,
  displayOrderByKey: ReadonlyMap<string, number>,
): number {
  return displayOrderByKey.get(descriptor.key) ?? descriptor.index - 1
}

export function snapshotDisplayOrder(
  orderedKeys: string[],
  displayOrderByKey: ReadonlyMap<string, number>,
): Map<string, number | undefined> {
  const previousOrder = new Map<string, number | undefined>()
  for (const key of orderedKeys) previousOrder.set(key, displayOrderByKey.get(key))
  return previousOrder
}

export function restoreDisplayOrder(
  displayOrderByKey: Map<string, number>,
  previousOrder: ReadonlyMap<string, number | undefined>,
): void {
  for (const [key, order] of previousOrder) {
    if (order === undefined) displayOrderByKey.delete(key)
    else displayOrderByKey.set(key, order)
  }
}

export function applyDisplayOrder(displayOrderByKey: Map<string, number>, orderedKeys: string[]): void {
  for (let i = 0; i < orderedKeys.length; i++) displayOrderByKey.set(orderedKeys[i], i)
}
