import { afterEach, expect, mock, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let tmp: string | null = null

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
})

test('flushSettings drains writes queued during an in-flight flush', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-test-'))
  mock.module('electron', () => ({ app: { getPath: () => tmp! } }))
  const settings = await import('#/main/settings.ts')
  const writeFile = fs.writeFile.bind(fs)
  let writes = 0
  ;(fs as unknown as { writeFile: typeof fs.writeFile }).writeFile = async (...args) => {
    writes += 1
    if (writes === 1) await settings.setFetchInterval(300)
    return writeFile(...args)
  }

  try {
    await settings.setThemePref('dark')
    await settings.flushSettings()
  } finally {
    ;(fs as unknown as { writeFile: typeof fs.writeFile }).writeFile = writeFile
  }

  const saved = JSON.parse(readFileSync(path.join(tmp, 'settings.json'), 'utf-8')) as { fetchIntervalSec: number }
  expect(writes).toBe(2)
  expect(saved.fetchIntervalSec).toBe(300)
})
