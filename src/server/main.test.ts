import { execa } from 'execa'
import { describe, expect, test } from 'vitest'
import packageJson from '../../package.json' with { type: 'json' }

describe('public command line', () => {
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
