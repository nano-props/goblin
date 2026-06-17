// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  captureTerminalHostGeometry,
  resolveTerminalCreateGeometry,
  TerminalHostNotMeasurableError,
  waitForMeasurableHost,
} from '#/web/components/terminal/terminal-session-geometry.ts'
import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'

const geometryMocks = vi.hoisted(() => ({
  preloadTerminalFont: vi.fn(async () => {}),
  proposeTerminalGeometry: vi.fn(() => ({ cols: 120, rows: 40 })),
}))

vi.mock('#/web/components/terminal/terminal-geometry.ts', () => ({
  preloadTerminalFont: geometryMocks.preloadTerminalFont,
  proposeTerminalGeometry: geometryMocks.proposeTerminalGeometry,
}))

type ObserverCallback = () => void

class MockResizeObserver {
  static instances: MockResizeObserver[] = []
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
  private readonly callback: ObserverCallback
  constructor(callback: ObserverCallback) {
    this.callback = callback
    MockResizeObserver.instances.push(this)
  }
  trigger(): void {
    this.callback()
  }
}

function descriptor(): TerminalDescriptor {
  return {
    key: '/repo\0/repo\0terminal-1',
    worktreeTerminalKey: '/repo\0/repo',
    terminalId: 'terminal-1',
    index: 1,
    repoRoot: '/repo',
    branch: 'main',
    worktreePath: '/repo',
  }
}

function makeHost(): HTMLDivElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return host
}

describe('terminal session geometry helpers', () => {
  beforeEach(() => {
    geometryMocks.preloadTerminalFont.mockClear()
    geometryMocks.proposeTerminalGeometry.mockClear()
  })

  test('captures geometry from a connected host and caches it', async () => {
    const host = makeHost()
    const geometryByWorktree = new Map<string, { cols: number; rows: number }>()

    const geometry = await captureTerminalHostGeometry({
      worktreeTerminalKey: '/repo\0/repo',
      hostByWorktree: new Map([['/repo\0/repo', host]]),
      geometryByWorktree,
    })

    expect(geometry).toEqual({ cols: 120, rows: 40 })
    expect(geometryByWorktree.get('/repo\0/repo')).toEqual({ cols: 120, rows: 40 })
  })

  test('falls back to selected attachment canonical size or cached geometry', async () => {
    const geometry = await resolveTerminalCreateGeometry({
      worktreeTerminalKey: '/repo\0/repo',
      hostByWorktree: new Map(),
      geometryByWorktree: new Map(),
      selectedDescriptor: descriptor(),
      getAttachmentSnapshot: () => ({
        role: 'controller',
        controllerStatus: 'connected',
        active: true,
        canTakeover: false,
        canonicalCols: 90,
        canonicalRows: 30,
      }),
    })
    expect(geometry).toEqual({ cols: 90, rows: 30 })

    const cached = await resolveTerminalCreateGeometry({
      worktreeTerminalKey: '/repo\0/repo',
      hostByWorktree: new Map(),
      geometryByWorktree: new Map([['/repo\0/repo', { cols: 70, rows: 20 }]]),
      selectedDescriptor: null,
      getAttachmentSnapshot: () => null,
    })
    expect(cached).toEqual({ cols: 70, rows: 20 })
  })
})

describe('waitForMeasurableHost', () => {
  beforeEach(() => {
    MockResizeObserver.instances = []
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: MockResizeObserver })
  })

  afterEach(() => {
    MockResizeObserver.instances = []
  })

  test('resolves immediately when the host is already measurable', async () => {
    const measure = vi.fn().mockReturnValue({ cols: 40, rows: 12 })
    const geometry = await waitForMeasurableHost(makeHost(), { measure })
    expect(geometry).toEqual({ cols: 40, rows: 12 })
    expect(MockResizeObserver.instances).toHaveLength(0)
  })

  test('waits for a ResizeObserver tick when the host is initially unmeasurable', async () => {
    const measure = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce({ cols: 60, rows: 20 })
    const promise = waitForMeasurableHost(makeHost(), { measure })
    await Promise.resolve()
    await Promise.resolve()
    expect(MockResizeObserver.instances).toHaveLength(1)
    MockResizeObserver.instances[0]!.trigger()
    const geometry = await promise
    expect(geometry).toEqual({ cols: 60, rows: 20 })
    expect(MockResizeObserver.instances[0]!.disconnect).toHaveBeenCalled()
  })

  test('tolerates multiple consecutive null returns from the ResizeObserver callback', async () => {
    const measure = vi.fn().mockReturnValue(null)
    const promise = waitForMeasurableHost(makeHost(), { measure })
    await Promise.resolve()
    await Promise.resolve()
    const observer = MockResizeObserver.instances[0]!
    observer.trigger()
    await Promise.resolve()
    observer.trigger()
    await Promise.resolve()
    // Switch the measure to return geometry on the next call.
    measure.mockReturnValueOnce({ cols: 70, rows: 22 })
    observer.trigger()
    const geometry = await promise
    expect(geometry).toEqual({ cols: 70, rows: 22 })
    expect(observer.disconnect).toHaveBeenCalledTimes(1)
  })

  test('a ResizeObserver tick after abort is a no-op', async () => {
    const measure = vi.fn().mockReturnValue(null)
    const controller = new AbortController()
    const promise = waitForMeasurableHost(makeHost(), { signal: controller.signal, measure })
    await Promise.resolve()
    await Promise.resolve()
    const observer = MockResizeObserver.instances[0]!
    const reason = new Error('disposed mid-wait')
    controller.abort(reason)
    await expect(promise).rejects.toBe(reason)
    // Triggering after abort must not throw, must not change settled state
    // (the promise stays rejected with the abort reason, not the late result).
    expect(() => observer.trigger()).not.toThrow()
    // A subsequent successful measurement must not flip the outcome.
    measure.mockReturnValueOnce({ cols: 60, rows: 20 })
    observer.trigger()
    await Promise.resolve()
    await expect(promise).rejects.toBe(reason)
  })

  test('rejects with TerminalHostNotMeasurableError when the host is inside a display:none subtree', async () => {
    const measure = vi.fn().mockReturnValue(null)
    const wrapper = document.createElement('div')
    wrapper.style.display = 'none'
    document.body.appendChild(wrapper)
    const host = document.createElement('div')
    wrapper.appendChild(host)
    await expect(waitForMeasurableHost(host, { measure })).rejects.toBeInstanceOf(TerminalHostNotMeasurableError)
    expect(MockResizeObserver.instances).toHaveLength(0)
  })

  test('rejects with the AbortSignal reason when the signal aborts before measurement', async () => {
    const measure = vi.fn().mockReturnValue(null)
    const controller = new AbortController()
    const reason = new Error('disposed mid-wait')
    controller.abort(reason)
    await expect(waitForMeasurableHost(makeHost(), { signal: controller.signal, measure })).rejects.toBe(reason)
    expect(MockResizeObserver.instances).toHaveLength(0)
  })

  test('aborts an in-flight wait when the signal aborts mid-wait', async () => {
    const measure = vi.fn().mockReturnValue(null)
    const controller = new AbortController()
    const promise = waitForMeasurableHost(makeHost(), { signal: controller.signal, measure })
    await Promise.resolve()
    await Promise.resolve()
    expect(MockResizeObserver.instances).toHaveLength(1)
    const reason = new Error('disposed mid-wait')
    controller.abort(reason)
    await expect(promise).rejects.toBe(reason)
    expect(MockResizeObserver.instances[0]!.disconnect).toHaveBeenCalled()
  })
})
