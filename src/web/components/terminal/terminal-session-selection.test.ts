import { describe, expect, test } from 'vitest'
import { resolveSelectedTerminalSessionId } from '#/web/components/terminal/terminal-session-selection.ts'
import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'

function descriptor(terminalSessionId: string): TerminalDescriptor {
  return {
    terminalSessionId,
    terminalWorktreeKey: 'repo\0wt',
    index: 1,
    repoRoot: '/repo',
    repoInstanceId: 'repo-instance-test',
    branch: 'main',
    worktreePath: '/repo',
  }
}

describe('terminal session selection helper', () => {
  test('prefers preferred selection, then current, then controller, then first terminal', () => {
    const isValid = (_worktreeKey: string, key: string) => ['session-1', 'session-2', 'session-3'].includes(key)
    const sortedDescriptors = [descriptor('session-1'), descriptor('session-2'), descriptor('session-3')]

    expect(
      resolveSelectedTerminalSessionId({
        terminalWorktreeKey: 'repo\0wt',
        preferredSessionId: 'session-3',
        currentSessionId: 'session-2',
        controllerSessionId: 'session-1',
        sortedDescriptors,
        isSelectedTerminalSessionIdValid: isValid,
      }),
    ).toBe('session-3')

    expect(
      resolveSelectedTerminalSessionId({
        terminalWorktreeKey: 'repo\0wt',
        preferredSessionId: 'missing',
        currentSessionId: 'session-2',
        controllerSessionId: 'session-1',
        sortedDescriptors,
        isSelectedTerminalSessionIdValid: isValid,
      }),
    ).toBe('session-2')

    expect(
      resolveSelectedTerminalSessionId({
        terminalWorktreeKey: 'repo\0wt',
        preferredSessionId: null,
        currentSessionId: null,
        controllerSessionId: 'session-1',
        sortedDescriptors,
        isSelectedTerminalSessionIdValid: isValid,
      }),
    ).toBe('session-1')

    expect(
      resolveSelectedTerminalSessionId({
        terminalWorktreeKey: 'repo\0wt',
        preferredSessionId: null,
        currentSessionId: null,
        controllerSessionId: null,
        sortedDescriptors,
        isSelectedTerminalSessionIdValid: isValid,
      }),
    ).toBe('session-1')
  })
})
