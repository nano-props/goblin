// @vitest-environment jsdom

import { afterEach, describe, expect, test } from 'vitest'
import {
  __resetCachedTerminalCellMetricsForTest,
  preloadTerminalFont,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_LINE_HEIGHT,
} from '#/web/components/terminal/terminal-geometry.ts'

describe('terminal-geometry cell-metrics cache invariant', () => {
  afterEach(() => {
    // Leave the module in a clean state for any other test that imports it.
    __resetCachedTerminalCellMetricsForTest()
  })

  test('exports the page-lifetime font constants', () => {
    // These constants are inputs to the cached cell-metrics measurement.
    // If any of them becomes user-configurable at runtime, the cache
    // invariant above is broken and __resetCachedTerminalCellMetricsForTest
    // must be called on the change path. This test guards the contract.
    expect(TERMINAL_FONT_SIZE).toBe(14)
    expect(TERMINAL_FONT_FAMILY).toBe("'Goblin Mono', monospace")
    expect(TERMINAL_LINE_HEIGHT).toBe(1)
  })

  test('__resetCachedTerminalCellMetricsForTest is callable and idempotent', () => {
    // In jsdom the probe never measures a positive dimension, so the
    // cache stays null and the reset is observably a no-op. The point
    // is that the export exists and is safe to call from a test.
    expect(() => __resetCachedTerminalCellMetricsForTest()).not.toThrow()
    expect(() => __resetCachedTerminalCellMetricsForTest()).not.toThrow()
  })

  test('preloadTerminalFont is a no-op when document.fonts.check is unavailable', async () => {
    // jsdom does not implement document.fonts.check / .load, so the
    // function should resolve immediately. This locks the
    // fast-path-for-missing-API contract used by tests and by the
    // T1.1 startup prewarm.
    await expect(preloadTerminalFont()).resolves.toBeUndefined()
  })
})
