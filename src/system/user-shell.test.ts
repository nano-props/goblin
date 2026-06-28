import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execa: vi.fn(),
}))

vi.mock('execa', () => ({
  execa: mocks.execa,
}))

import { userShellCommandExists } from '#/system/user-shell.ts'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('userShellCommandExists', () => {
  test('checks commands through the user shell on Unix', async () => {
    const originalShell = process.env.SHELL
    process.env.SHELL = '/bin/zsh'
    mocks.execa.mockResolvedValueOnce({ exitCode: 0 })

    try {
      await expect(userShellCommandExists('bat', '/tmp/repo')).resolves.toBe(true)
    } finally {
      if (originalShell === undefined) delete process.env.SHELL
      else process.env.SHELL = originalShell
    }

    if (process.platform === 'win32') return
    expect(mocks.execa).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-il', '-c', "command -v 'bat' >/dev/null 2>&1"],
      expect.objectContaining({ cwd: '/tmp/repo', reject: false }),
    )
  })

  test('rejects unsafe command names before spawning', async () => {
    await expect(userShellCommandExists('bat; whoami', '/tmp/repo')).resolves.toBe(false)

    expect(mocks.execa).not.toHaveBeenCalled()
  })

  test('falls back to false when the command cannot be resolved', async () => {
    mocks.execa.mockResolvedValueOnce({ exitCode: 1 })

    await expect(userShellCommandExists('bat', '/tmp/repo')).resolves.toBe(false)
  })
})
