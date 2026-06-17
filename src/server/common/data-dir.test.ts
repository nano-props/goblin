import { afterEach, describe, expect, test } from 'vitest'

const originalEnv = { ...process.env }

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('serverDataDir', () => {
  test('prefers an explicit data dir override', async () => {
    process.env.GOBLIN_SERVER_DATA_DIR = '/tmp/goblin-explicit'
    const { serverDataDir } = await import('#/shared/data-dir.ts')
    expect(serverDataDir()).toBe('/tmp/goblin-explicit')
  })

  test('uses a stable user-level fallback when no explicit override exists', async () => {
    delete process.env.GOBLIN_SERVER_DATA_DIR
    delete process.env.XDG_STATE_HOME
    delete process.env.LOCALAPPDATA
    delete process.env.APPDATA
    delete process.env.USERPROFILE
    process.env.HOME = '/Users/tester'
    if (process.platform === 'win32') {
      delete process.env.HOME
      process.env.LOCALAPPDATA = 'C:\\Users\\tester\\AppData\\Local'
    }
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      process.env.HOME = '/home/tester'
    }
    const { serverDataDir } = await import('#/shared/data-dir.ts')
    const dir = serverDataDir()
    if (process.platform === 'darwin') {
      expect(dir).toBe('/Users/tester/Library/Application Support/Goblin')
      return
    }
    if (process.platform === 'win32') {
      expect(dir).toBe('C:\\Users\\tester\\AppData\\Local\\Goblin')
      return
    }
    expect(dir).toBe('/home/tester/.local/state/goblin')
  })
})
