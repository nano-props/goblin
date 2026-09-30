import { afterEach, describe, expect, test, vi } from 'vitest'
import { resolveLocalShell, resolveLocalShellWithStartupShellCommand } from '#/server/terminal/terminal-local-shell.ts'

const { userInfo } = vi.hoisted(() => ({ userInfo: vi.fn(() => ({ shell: '/bin/zsh' })) }))
vi.mock('node:os', () => ({ userInfo }))
afterEach(() => vi.clearAllMocks())

describe('local terminal shell resolution', () => {
  test('preserves explicit command arguments instead of using the login shell', () => {
    expect(resolveLocalShell({ command: ' /bin/sh ', args: ['-c', 'echo ready'] }, { SHELL: '/bin/zsh' })).toEqual({
      command: '/bin/sh',
      args: ['-c', 'echo ready'],
    })
    expect(userInfo).not.toHaveBeenCalled()
  })

  test('uses the inherited shell as a login shell', () => {
    expect(resolveLocalShell({}, { SHELL: ' /bin/bash ' })).toEqual({ command: '/bin/bash', args: ['-l'] })
    expect(userInfo).not.toHaveBeenCalled()
  })

  test('uses the user login shell when SHELL is empty', () => {
    expect(resolveLocalShell({}, { SHELL: ' ' })).toEqual({ command: '/bin/zsh', args: ['-l'] })
  })

  test('uses a POSIX shell when user information is unavailable', () => {
    userInfo.mockImplementationOnce(() => {
      throw new Error('user unavailable')
    })
    expect(resolveLocalShell({}, {})).toEqual({ command: '/bin/sh', args: ['-l'] })
  })

  test('runs startup commands once before replacing the process with a login shell', () => {
    expect(resolveLocalShellWithStartupShellCommand('echo ready\r\n', { SHELL: '/bin/zsh' })).toEqual({
      command: '/bin/zsh',
      args: ['-ilc', "echo ready\nexec '/bin/zsh' -l"],
    })
  })

  test.each([undefined, '', ' \r\n'])('opens a login shell for an empty startup command %j', (command) => {
    expect(resolveLocalShellWithStartupShellCommand(command, { SHELL: '/bin/sh' })).toEqual({
      command: '/bin/sh',
      args: ['-l'],
    })
  })
})
