import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let tmp: string | null = null
let previousDataDir: string | undefined

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
  if (previousDataDir === undefined) delete process.env.GOBLIN_SERVER_DATA_DIR
  else process.env.GOBLIN_SERVER_DATA_DIR = previousDataDir
  vi.resetModules()
  vi.doUnmock('write-file-atomic')
})

test('continues processing queued settings writes after a write failure', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-settings-persistence-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const writeFileAtomic = vi
    .fn()
    .mockRejectedValueOnce(new Error('disk full'))
    .mockImplementationOnce(async (file: string, payload: string) => {
      await import('node:fs/promises').then((fs) => fs.writeFile(file, payload, 'utf-8'))
    })
  vi.doMock('write-file-atomic', () => ({ default: writeFileAtomic }))

  const persistence = await import('#/server/modules/settings-persistence.ts')

  await expect(persistence.writeUserSettingsJson({ value: 'first' })).rejects.toThrow('disk full')
  await expect(persistence.writeUserSettingsJson({ value: 'second' })).resolves.toBeUndefined()

  expect(JSON.parse(readFileSync(path.join(tmp, 'user-settings.json'), 'utf-8'))).toEqual({ value: 'second' })
})
