import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { resolveTerminalWorkerEntry } from '#/server/terminal/terminal-worker-entry.ts'

describe('terminal worker entry path', () => {
  test('prefers built terminal worker entry when present', () => {
    const dirname = '/tmp/goblin/dist/server'
    const built = path.resolve(dirname, 'terminal-worker.js')

    expect(resolveTerminalWorkerEntry(dirname, (candidate) => candidate === built)).toBe(built)
  })

  test('falls back to source terminal worker entry when built artifact is absent', () => {
    const dirname = '/tmp/goblin/src/server/entrypoints'
    const source = path.resolve(dirname, 'terminal-worker.ts')

    expect(resolveTerminalWorkerEntry(dirname, (candidate) => candidate === source)).toBe(source)
  })

  test('throws when no terminal worker entry exists in the provided directory', () => {
    expect(() => resolveTerminalWorkerEntry('/tmp/goblin/missing', () => false)).toThrow(
      'Terminal worker entry not found in /tmp/goblin/missing',
    )
  })
})
