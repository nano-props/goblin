import type { FiletreeRow } from '#/web/components/workspace-pane/filetree-collection.ts'

export const FILETREE_ROW_HEIGHT = 24

export function firstFiletreeKey(keys: ReadonlySet<string>): string | null {
  return keys.values().next().value ?? null
}

export function focusFiletreeRowAtIndex(
  viewport: HTMLElement | null,
  virtualizer: { scrollToIndex: (index: number) => void },
  index: number,
): void {
  if (!viewport || index < 0) return
  const selector = `[data-filetree-row-index="${index}"]`
  const mountedRow = viewport.querySelector<HTMLElement>(selector)
  if (mountedRow) {
    mountedRow.focus()
    return
  }
  virtualizer.scrollToIndex(index)
  requestAnimationFrame(() => {
    viewport.querySelector<HTMLElement>(selector)?.focus()
  })
}

export function findTypeaheadRowIndex(rows: ReadonlyArray<FiletreeRow>, currentIndex: number, key: string): number {
  const needle = key.toLocaleLowerCase()
  if (!needle) return -1
  for (let offset = 1; offset <= rows.length; offset += 1) {
    const index = (Math.max(0, currentIndex) + offset) % rows.length
    if (rows[index]?.node.name.toLocaleLowerCase().startsWith(needle)) return index
  }
  return -1
}

export function topVisibleFiletreeRowIndex(viewport: HTMLElement): number {
  return Math.max(0, Math.floor(viewport.scrollTop / FILETREE_ROW_HEIGHT))
}
