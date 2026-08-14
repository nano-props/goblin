import { describe, expect, test } from 'vitest'
import { remoteExecResult } from '#/system/ssh/command-execution.ts'
import type { RemoteCommandResult } from '#/system/ssh/commands.ts'

describe('remote command execution', () => {
  test('prefers message over stderr when converting remote exec failures', () => {
    expect(
      remoteExecResult({
        ok: false,
        stdout: '',
        stderr: 'permission denied',
        message: 'unknown',
      } as RemoteCommandResult),
    ).toEqual({ ok: false, message: 'unknown' })
  })
})
