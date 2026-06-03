import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let tmp: string | null = null

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
  vi.resetModules()
  vi.doUnmock('electron')
  vi.doUnmock('write-file-atomic')
})

test('returns the default window state when window-state.json is missing', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-window-state-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const windowState = await import('#/main/window-state.ts')

  const loaded = await windowState.loadWindowState()

  expect(loaded.windowBounds).toBeNull()
})

test('persists window bounds to window-state.json', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-window-state-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const windowState = await import('#/main/window-state.ts')

  await windowState.setWindowBounds({ x: 5, y: 6, width: 1200, height: 760 })
  const flushed = await windowState.flushWindowState()

  expect(flushed).toBe(true)
  const saved = JSON.parse(readFileSync(path.join(tmp, 'window-state.json'), 'utf-8')) as {
    windowBounds: { x: number; y: number; width: number; height: number }
  }
  expect(saved.windowBounds).toEqual({ x: 5, y: 6, width: 1200, height: 760 })
})
