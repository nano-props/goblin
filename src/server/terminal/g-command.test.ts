import { mkdtempDisposableSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { buildGoblinTerminalCommandEnvironment, resolveGoblinCommandEntry } from '#/server/terminal/g-command.ts'

function makeTmpDir() {
  return mkdtempDisposableSync(path.join(os.tmpdir(), 'goblin-g-command-'))
}

describe('g terminal command', () => {
  test('builds the terminal environment from static launcher resources', () => {
    using temporaryDirectory = makeTmpDir()
    const binDir = temporaryDirectory.path
    writeFileSync(path.join(binDir, process.platform === 'win32' ? 'g.cmd' : 'g'), '')
    const entryPath = path.join(binDir, 'g-command.js')
    writeFileSync(entryPath, '')

    const env = buildGoblinTerminalCommandEnvironment({
      binDir,
      entryPath,
      serverUrl: 'http://127.0.0.1:32100',
      accessToken: 'secret',
      currentPath: '/usr/bin',
      nodePath: '/node',
    })

    expect(env).toMatchObject({
      PATH: `${binDir}${path.delimiter}/usr/bin`,
      GOBLIN_TERMINAL: '1',
      GOBLIN_SERVER_URL: 'http://127.0.0.1:32100',
      GOBLIN_SERVER_ACCESS_TOKEN: 'secret',
      GOBLIN_NODE: '/node',
      GOBLIN_CLI_ENTRY: entryPath,
    })
  })

  test('refuses to build an environment when the packaged entrypoint is missing', () => {
    using temporaryDirectory = makeTmpDir()
    const binDir = temporaryDirectory.path
    writeFileSync(path.join(binDir, process.platform === 'win32' ? 'g.cmd' : 'g'), '')

    const env = buildGoblinTerminalCommandEnvironment({
      binDir,
      entryPath: path.join(binDir, 'missing.js'),
      serverUrl: 'http://127.0.0.1:32100',
      accessToken: 'secret',
    })

    expect(env).toBeNull()
  })

  test('resolves built command entry before source fallback', () => {
    using temporaryDirectory = makeTmpDir()
    const dir = temporaryDirectory.path
    const built = path.join(dir, 'g-command.js')
    const source = path.join(dir, 'g-command.ts')
    writeFileSync(built, '')
    writeFileSync(source, '')

    expect(resolveGoblinCommandEntry(dir)).toBe(built)
  })
})
