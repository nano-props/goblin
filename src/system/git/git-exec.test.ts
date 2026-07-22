import { afterEach, describe, expect, test } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { git } from '#/system/git/git-exec.ts'
import { OperationCancelledError } from '#/shared/operation-cancelled.ts'

let tmp: string | null = null

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
})

describe('git', () => {
  test('normalizes process cancellation at the git boundary', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(git(process.cwd(), ['status'], { signal: controller.signal })).rejects.toBeInstanceOf(
      OperationCancelledError,
    )
  })

  test('times out promptly when git ignores SIGTERM', async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-helper-test-'))
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
      // Expected budget is ~timeoutMs (300) + forceKillAfterDelay (500) plus
      // process spawn/kill overhead. Generous ceiling to avoid flaking under
      // load (parallel test runs, slow CI runners) while still catching a
      // genuinely broken kill path (which would hang far longer than this).
      expect(performance.now() - started).toBeLessThan(5_000)
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
    }
  })
})
