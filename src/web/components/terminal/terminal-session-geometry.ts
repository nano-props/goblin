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

/**
 * Resolves with the first measured geometry the host reports, instead of
 * forcing the caller to fall back to a default like 80x24 when the host is
 * briefly unmeasurable on attach (e.g. a split pane that is still animating
 * to its final width).
 *
 * Spawning a PTY at the wrong column count and resizing later is not
 * equivalent to spawning it at the correct width — shells like zsh compute
 * their prompt layout from `$COLUMNS` at prompt-render time and many
 * configurations do not redraw the visible prompt on SIGWINCH.
 *
 * The wait has no hardcoded timeout. It is driven entirely by the host's
 * `ResizeObserver` callbacks; if the host is in a `display:none` subtree
 * (and therefore cannot ever produce a size) the function rejects
 * immediately instead of waiting. The caller controls cancellation via an
 * `AbortSignal` — typically wired to session disposal so an aborted attach
 * does not leak the observer subscription.
 *
 * `measure` is dependency-injected so tests can drive the host without
 * relying on jsdom layout. In production it defaults to `proposeTerminalGeometry`.
 */
export function waitForMeasurableHost(
  host: HTMLElement,
  options: {
    signal?: AbortSignal
    measure?: (host: HTMLElement) => { cols: number; rows: number } | null
  } = {},
): Promise<{ cols: number; rows: number }> {
  // An aborted caller should not be told the host is unmeasurable —
  // the abort reason is more informative.
  if (options.signal?.aborted) {
    return Promise.reject(options.signal.reason ?? new Error('aborted'))
  }
  const measure = options.measure ?? proposeTerminalGeometry
  const immediate = measure(host)
  if (immediate) return Promise.resolve(immediate)
  if (isHostInDisplayNoneSubtree(host)) {
    return Promise.reject(new TerminalHostNotMeasurableError('host is inside a display:none subtree'))
  }
  if (typeof ResizeObserver === 'undefined') {
    return Promise.reject(
      new TerminalHostNotMeasurableError('ResizeObserver unavailable; cannot wait for host to become measurable'),
    )
  }
  return new Promise<{ cols: number; rows: number }>((resolve, reject) => {
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      observer.disconnect()
      options.signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = () => settle(() => reject(options.signal?.reason ?? new Error('aborted')))
    const observer = new ResizeObserver(() => {
      const next = measure(host)
      if (next) settle(() => resolve(next))
    })
    observer.observe(host)
    options.signal?.addEventListener('abort', onAbort)
  })
}

export class TerminalHostNotMeasurableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TerminalHostNotMeasurableError'
  }
}

/**
 * Walks the ancestor chain looking for `display: none`. This relies on
 * `getComputedStyle` rather than `offsetParent` because the latter is
 * unreliable in non-browser layout engines (notably jsdom, where
 * `offsetParent` is always `null` regardless of CSS).
 */
function isHostInDisplayNoneSubtree(host: HTMLElement): boolean {
  let node: HTMLElement | null = host
  // Walk up to and including <html>. If any node in the chain has
  // display:none the host can never produce a measurable box.
  while (node) {
    if (getComputedStyle(node).display === 'none') return true
    if (node === document.documentElement) return false
    node = node.parentElement
  }
  return false
}
