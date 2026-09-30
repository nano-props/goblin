import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { buildGoblinTerminalCommandEnvironment, createGoblinCommandLauncher } from '#/server/terminal/g-command.ts'

describe('g terminal command', () => {
  test('quotes the executable prefix and forwards arguments literally', () => {
    const launcher = createGoblinCommandLauncher(['/usr/bin/printf', '%s\n', "a ' quoted $value"])
    try {
      expect(execFileSync(path.join(launcher.binDir, 'g'), ['two words', '$(false)'], { encoding: 'utf8' })).toBe(
        "a ' quoted $value\ng\ntwo words\n$(false)\n",
      )
    } finally {
      launcher.dispose()
    }
    expect(existsSync(launcher.binDir)).toBe(false)
  })
  test('injects credentials only into the PTY environment', () => {
    const launcher = createGoblinCommandLauncher(['/app/goblin'])
    try {
      const env = buildGoblinTerminalCommandEnvironment({
        binDir: launcher.binDir,
        terminalSessionId: 'term-example',
        serverUrl: 'http://127.0.0.1:32100',
        accessToken: 'example-secret',
        currentPath: '/usr/bin',
      })
      expect(env).toEqual({
        PATH: launcher.binDir + path.delimiter + '/usr/bin',
        GOBLIN_TERMINAL: '1',
        GOBLIN_TERMINAL_SESSION_ID: 'term-example',
        GOBLIN_SERVER_URL: 'http://127.0.0.1:32100',
        GOBLIN_SERVER_ACCESS_TOKEN: 'example-secret',
      })
      expect(readFileSync(path.join(launcher.binDir, 'g'), 'utf8')).not.toContain('example-secret')
    } finally {
      launcher.dispose()
    }
    expect(
      buildGoblinTerminalCommandEnvironment({
        binDir: launcher.binDir,
        terminalSessionId: 'term-example',
        serverUrl: 'http://127.0.0.1:32100',
        accessToken: 'example-secret',
      }),
    ).toBeNull()
  })
})
