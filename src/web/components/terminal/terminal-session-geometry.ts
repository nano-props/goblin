import {
  estimateManagedTerminalGeometry,
  estimateTerminalGeometry,
} from '#/web/components/terminal/terminal-geometry.ts'
import type { TerminalClientSnapshot, TerminalDescriptor } from '#/web/components/terminal/types.ts'

export function captureTerminalHostGeometry(input: {
  terminalFilesystemTargetKey: string
  hostByFilesystemTarget: ReadonlyMap<string, HTMLElement>
  startupGeometryHintByFilesystemTarget: Map<string, { cols: number; rows: number }>
}): { cols: number; rows: number } | null {
  const host = input.hostByFilesystemTarget.get(input.terminalFilesystemTargetKey)
  if (!host?.isConnected) return null
  const geometry = estimateManagedTerminalGeometry(host)
  if (!geometry) return null
  input.startupGeometryHintByFilesystemTarget.set(input.terminalFilesystemTargetKey, geometry)
  return geometry
}

/**
 * Non-blocking startup hint for terminal creation. This helper never waits for
 * host registration or ResizeObserver callbacks: if a measured host or cached
 * canonical size is already available, use it; otherwise let the caller choose
 * a default. The live xterm view becomes geometry authority after attach.
 */
export function resolveTerminalStartupGeometryHint(input: {
  terminalFilesystemTargetKey: string
  hostByFilesystemTarget: ReadonlyMap<string, HTMLElement>
  startupGeometryHintByFilesystemTarget: Map<string, { cols: number; rows: number }>
  selectedDescriptor: TerminalDescriptor | null
  getAttachmentSnapshot: (terminalSessionId: string) => TerminalClientSnapshot | null | undefined
}): { cols: number; rows: number } | null {
  const measured = captureTerminalHostGeometry(input)
  if (measured) return measured
  if (input.selectedDescriptor) {
    const attachment = input.getAttachmentSnapshot(input.selectedDescriptor.terminalSessionId)
    if (attachment?.canonicalCols && attachment.canonicalRows) {
      const geometry = { cols: attachment.canonicalCols, rows: attachment.canonicalRows }
      input.startupGeometryHintByFilesystemTarget.set(input.terminalFilesystemTargetKey, geometry)
      return geometry
    }
  }
  return input.startupGeometryHintByFilesystemTarget.get(input.terminalFilesystemTargetKey) ?? null
}

/**
 * Resolves with the first real view geometry the host reports during attach,
 * instead of falling back to a default while the xterm host is briefly
 * unmeasurable.
 *
 * The wait is driven by `ResizeObserver` callbacks and is cancelable. If the
 * host is in a `display:none` subtree (and therefore cannot ever produce a
 * size), the function rejects immediately. The caller can pass `timeoutMs` to
 * bound the wait, or `signal` for explicit cancellation (for example on
 * projection teardown), so neither attach nor resize-driven waits leak subscriptions.
 *
 * `measure` is dependency-injected so tests can drive the host without
 * relying on jsdom layout. In production it defaults to a lightweight host-box
 * estimate for generic hosts; `TerminalSession` passes the xterm openability
 * predicate for the real attach path.
 */
export function waitForMeasurableHost(
  host: HTMLElement,
  options: {
    signal?: AbortSignal
    measure?: (host: HTMLElement) => { cols: number; rows: number } | null
    timeoutMs?: number
  } = {},
): Promise<{ cols: number; rows: number }> {
  // An aborted caller should not be told the host is unmeasurable —
  // the abort reason is more informative.
  if (options.signal?.aborted) {
    return Promise.reject(options.signal.reason ?? new Error('aborted'))
  }
  const measure = options.measure ?? estimateTerminalGeometry
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
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  return new Promise<{ cols: number; rows: number }>((resolve, reject) => {
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      observer.disconnect()
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
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
    const timeoutMs = options.timeoutMs
    if (timeoutMs != null && timeoutMs > 0) {
      timeoutId = setTimeout(
        () => settle(() => reject(new Error(`terminal host measurable wait timed out after ${timeoutMs}ms`))),
        timeoutMs,
      )
    }
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
