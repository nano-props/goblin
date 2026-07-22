import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-settings-persistence-'))
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

test('leaves malformed JSON in place and fails every read', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-settings-persistence-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const file = path.join(tmp, 'user-settings.json')
  writeFileSync(file, '{bad json', 'utf-8')
  const persistence = await import('#/server/modules/settings-persistence.ts')

  await expect(persistence.readUserSettingsJson()).rejects.toBeInstanceOf(SyntaxError)
  await expect(persistence.readUserSettingsJson()).rejects.toBeInstanceOf(SyntaxError)
  expect(readFileSync(file, 'utf-8')).toBe('{bad json')
})

test('distinguishes a persisted JSON null from a missing file', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-settings-persistence-'))
  previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
  process.env.GOBLIN_SERVER_DATA_DIR = tmp
  const persistence = await import('#/server/modules/settings-persistence.ts')

  await expect(persistence.readUserSettingsJson()).resolves.toEqual({ kind: 'missing' })
  writeFileSync(path.join(tmp, 'user-settings.json'), 'null', 'utf-8')
  await expect(persistence.readUserSettingsJson()).resolves.toEqual({ kind: 'loaded', value: null })
})
