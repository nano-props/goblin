import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { git } from '#/main/git/helper.ts'

let tmp: string | null = null

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
})

describe('git', () => {
  test('times out promptly when git ignores SIGTERM', async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-helper-test-'))
    const bin = path.join(tmp, 'bin')
    mkdirSync(bin)
    const fakeGit = path.join(bin, 'git')
    writeFileSync(fakeGit, '#!/bin/sh\ntrap "" TERM\nwhile :; do sleep 1; done\n')
    chmodSync(fakeGit, 0o755)
    const originalPath = process.env.PATH
    process.env.PATH = `${bin}${path.delimiter}${originalPath ?? ''}`

    try {
      const started = performance.now()
      let err: unknown
      try {
        await git(tmp, ['status'], { timeoutMs: 300 })
      } catch (caught) {
        err = caught
      }

      expect(err).toBeInstanceOf(Error)
      expect((err as { timedOut?: boolean }).timedOut).toBe(true)
      expect(performance.now() - started).toBeLessThan(1_500)
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
    }
  })
})
