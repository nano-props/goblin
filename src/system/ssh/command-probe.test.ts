import { describe, expect, test, vi } from 'vitest'
import { remoteCommandExistsAtPath } from '#/system/ssh/command-probe.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'
import { TARGET, okRemoteResult } from '#/system/ssh/git/test-utils.ts'

describe('remote command probe', () => {
  test('checks an explicitly authorized workspace root without inventing Git membership', async () => {
    const run = vi.fn<RemoteCommandRunner>(async () => okRemoteResult(''))

    await expect(remoteCommandExistsAtPath(TARGET, '/srv/plain-workspace', 'bat', { run })).resolves.toBe(true)
    expect(run).toHaveBeenCalledWith(
      { type: 'commandExists', path: '/srv/plain-workspace', commandName: 'bat' },
      TARGET,
      { signal: undefined },
    )
  })
})
