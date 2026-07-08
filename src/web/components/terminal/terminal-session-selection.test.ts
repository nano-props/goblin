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
    const isValid = (_worktreeKey: string, key: string) => ['term-111111111111111111111', 'term-222222222222222222222', 'term-333333333333333333333'].includes(key)
    const sortedDescriptors = [descriptor('term-111111111111111111111'), descriptor('term-222222222222222222222'), descriptor('term-333333333333333333333')]

    expect(
      resolveSelectedTerminalSessionId({
        terminalWorktreeKey: 'repo\0wt',
        preferredSessionId: 'term-333333333333333333333',
        currentSessionId: 'term-222222222222222222222',
        controllerSessionId: 'term-111111111111111111111',
        sortedDescriptors,
        isSelectedTerminalSessionIdValid: isValid,
      }),
    ).toBe('term-333333333333333333333')

    expect(
      resolveSelectedTerminalSessionId({
        terminalWorktreeKey: 'repo\0wt',
        preferredSessionId: 'missing',
        currentSessionId: 'term-222222222222222222222',
        controllerSessionId: 'term-111111111111111111111',
        sortedDescriptors,
        isSelectedTerminalSessionIdValid: isValid,
      }),
    ).toBe('term-222222222222222222222')

    expect(
      resolveSelectedTerminalSessionId({
        terminalWorktreeKey: 'repo\0wt',
        preferredSessionId: null,
        currentSessionId: null,
        controllerSessionId: 'term-111111111111111111111',
        sortedDescriptors,
        isSelectedTerminalSessionIdValid: isValid,
      }),
    ).toBe('term-111111111111111111111')

    expect(
      resolveSelectedTerminalSessionId({
        terminalWorktreeKey: 'repo\0wt',
        preferredSessionId: null,
        currentSessionId: null,
        controllerSessionId: null,
        sortedDescriptors,
        isSelectedTerminalSessionIdValid: isValid,
      }),
    ).toBe('term-111111111111111111111')
  })
})
