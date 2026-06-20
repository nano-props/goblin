import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  buildGoblinTerminalCommandEnvironment,
  resolveGoblinCommandEntry,
} from '#/server/terminal/g-command.ts'

const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'goblin-g-command-'))
  tmpDirs.push(dir)
  return dir
}

describe('g terminal command', () => {
  test('builds the terminal environment from static launcher resources', () => {
    const binDir = makeTmpDir()
    writeFileSync(path.join(binDir, process.platform === 'win32' ? 'g.cmd' : 'g'), '')
    const entryPath = path.join(binDir, 'g-command.js')
    writeFileSync(entryPath, '')

    const env = buildGoblinTerminalCommandEnvironment({
      binDir,
      entryPath,
      serverUrl: 'http://127.0.0.1:32100',
      accessToken: 'secret',
      repoRoot: '/repo',
      worktreePath: '/repo/worktree',
      currentPath: '/usr/bin',
      nodePath: '/node',
    })

    expect(env).toMatchObject({
      PATH: `${binDir}${path.delimiter}/usr/bin`,
      GOBLIN_TERMINAL: '1',
      GOBLIN_SERVER_URL: 'http://127.0.0.1:32100',
      GOBLIN_SERVER_ACCESS_TOKEN: 'secret',
      GOBLIN_REPO_ROOT: '/repo',
      GOBLIN_WORKTREE_PATH: '/repo/worktree',
      GOBLIN_NODE: '/node',
      GOBLIN_CLI_ENTRY: entryPath,
    })
  })

  test('refuses to build an environment when the packaged entrypoint is missing', () => {
    const binDir = makeTmpDir()
    writeFileSync(path.join(binDir, process.platform === 'win32' ? 'g.cmd' : 'g'), '')

    const env = buildGoblinTerminalCommandEnvironment({
      binDir,
      entryPath: path.join(binDir, 'missing.js'),
      serverUrl: 'http://127.0.0.1:32100',
      accessToken: 'secret',
      repoRoot: '/repo',
      worktreePath: '/repo/worktree',
    })

    expect(env).toBeNull()
  })

  test('resolves built command entry before source fallback', () => {
    const dir = makeTmpDir()
    const built = path.join(dir, 'g-command.js')
    const source = path.join(dir, 'g-command.ts')
    writeFileSync(built, '')
    writeFileSync(source, '')

    expect(resolveGoblinCommandEntry(dir)).toBe(built)
  })
})
