import { execa } from 'execa'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import packageJson from '../../package.json' with { type: 'json' }

describe('public command line', () => {
  test('open returns while the browser launcher is still running', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'goblin-open-'))
    const receipt = path.join(directory, 'receipt')
    const launcher = path.join(directory, process.platform === 'darwin' ? 'open' : 'xdg-open')
    await writeFile(
      launcher,
      '#!/bin/sh\nprintf "%s\\n%s\\n" "$$" "$1" > "$GOBLIN_TEST_RECEIPT"\nexec /bin/sleep 30\n',
      { mode: 0o755 },
    )
    try {
      const result = await execa('bun', ['src/server/main.ts', 'open', '/srv/example', '--port', '43219'], {
        timeout: 5000,
        env: {
          PATH: `${directory}:${process.env.PATH}`,
          GOBLIN_TEST_RECEIPT: receipt,
          GOBLIN_SERVER_HOST: '127.0.0.1',
        },
      })
      await vi.waitFor(async () => expect(await readFile(receipt, 'utf8')).toContain('/open?path='))
      const [pid, url] = (await readFile(receipt, 'utf8')).trim().split('\n')
      expect(url).toBe('http://127.0.0.1:43219/open?path=%2Fsrv%2Fexample')
      expect(result.stdout).toBe(url)
      expect(result.stderr).toBe('')
      expect(() => process.kill(Number(pid), 0)).not.toThrow()
    } finally {
      const contents = await readFile(receipt, 'utf8').catch(() => '')
      if (contents) process.kill(Number(contents.split('\n')[0]), 'SIGKILL')
      await rm(directory, { recursive: true, force: true })
    }
  })

  test.each([[], ['--help'], ['-h'], ['serve', '--help'], ['open', '-h']])(
    'prints help without starting a server: %j',
    async (...args) => {
      const result = await execa('bun', ['src/server/main.ts', ...args], { timeout: 5000 })
      expect(result.stdout).toContain('Usage: goblin <command> [options]')
      expect(result.stdout).not.toContain('[server]')
      expect(result.stderr).toBe('')
    },
  )

  test.each(['--version', '-v'])('prints the package version for %s', async (flag) => {
    const result = await execa('bun', ['src/server/main.ts', flag], { timeout: 5000 })
    expect(result.stdout).toBe(packageJson.version)
    expect(result.stderr).toBe('')
  })

  test.each([['unknown'], ['--port', '43210'], ['open', '--unknown'], ['serve', '--unknown']])(
    'rejects invalid commands without starting the server: %j',
    async (...args) => {
      const result = await execa('bun', ['src/server/main.ts', ...args], { timeout: 5000, reject: false })
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
    },
  )
})
