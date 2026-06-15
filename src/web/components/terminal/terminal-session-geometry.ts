import { preloadTerminalFont, proposeTerminalGeometry } from '#/web/components/terminal/terminal-geometry.ts'
import type { TerminalAttachmentSnapshot, TerminalDescriptor } from '#/web/components/terminal/types.ts'

export async function captureTerminalHostGeometry(input: {
  worktreeTerminalKey: string
  hostByWorktree: ReadonlyMap<string, HTMLElement>
  geometryByWorktree: Map<string, { cols: number; rows: number }>
}): Promise<{ cols: number; rows: number } | null> {
  const host = input.hostByWorktree.get(input.worktreeTerminalKey)
  if (!host?.isConnected) return null
  await preloadTerminalFont()
  const geometry = proposeTerminalGeometry(host)
  if (!geometry) return null
  input.geometryByWorktree.set(input.worktreeTerminalKey, geometry)
  return geometry
}

export async function resolveTerminalCreateGeometry(input: {
  worktreeTerminalKey: string
  hostByWorktree: ReadonlyMap<string, HTMLElement>
  geometryByWorktree: Map<string, { cols: number; rows: number }>
  selectedDescriptor: TerminalDescriptor | null
  getAttachmentSnapshot: (key: string) => TerminalAttachmentSnapshot | null | undefined
}): Promise<{ cols: number; rows: number } | null> {
  const measured = await captureTerminalHostGeometry(input)
  if (measured) return measured
  if (input.selectedDescriptor) {
    const attachment = input.getAttachmentSnapshot(input.selectedDescriptor.key)
    if (attachment?.canonicalCols && attachment.canonicalRows) {
      const geometry = { cols: attachment.canonicalCols, rows: attachment.canonicalRows }
      input.geometryByWorktree.set(input.worktreeTerminalKey, geometry)
      return geometry
    }
  }
  return input.geometryByWorktree.get(input.worktreeTerminalKey) ?? null
}
