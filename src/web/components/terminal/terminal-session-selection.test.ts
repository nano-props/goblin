import { describe, expect, test } from 'vitest'
import { resolveSelectedTerminalKey } from '#/web/components/terminal/terminal-session-selection.ts'
import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'

function descriptor(terminalKey: string): TerminalDescriptor {
  return {
    terminalKey,
    worktreeTerminalKey: 'repo\0wt',
    sessionId: terminalKey,
    index: 1,
    repoRoot: '/repo',
    branch: 'main',
    worktreePath: '/repo',
  }
}

describe('terminal session selection helper', () => {
  test('prefers preferred selection, then current, then controller, then first terminal', () => {
    const isValid = (_worktreeKey: string, key: string) => ['session-1', 'session-2', 'session-3'].includes(key)
    const sortedDescriptors = [descriptor('session-1'), descriptor('session-2'), descriptor('session-3')]

    expect(
      resolveSelectedTerminalKey({
        worktreeTerminalKey: 'repo\0wt',
        preferredTerminalKey: 'session-3',
        currentTerminalKey: 'session-2',
        controllerTerminalKey: 'session-1',
        sortedDescriptors,
        isSelectedTerminalKeyValid: isValid,
      }),
    ).toBe('session-3')

    expect(
      resolveSelectedTerminalKey({
        worktreeTerminalKey: 'repo\0wt',
        preferredTerminalKey: 'missing',
        currentTerminalKey: 'session-2',
        controllerTerminalKey: 'session-1',
        sortedDescriptors,
        isSelectedTerminalKeyValid: isValid,
      }),
    ).toBe('session-2')

    expect(
      resolveSelectedTerminalKey({
        worktreeTerminalKey: 'repo\0wt',
        preferredTerminalKey: null,
        currentTerminalKey: null,
        controllerTerminalKey: 'session-1',
        sortedDescriptors,
        isSelectedTerminalKeyValid: isValid,
      }),
    ).toBe('session-1')

    expect(
      resolveSelectedTerminalKey({
        worktreeTerminalKey: 'repo\0wt',
        preferredTerminalKey: null,
        currentTerminalKey: null,
        controllerTerminalKey: null,
        sortedDescriptors,
        isSelectedTerminalKeyValid: isValid,
      }),
    ).toBe('session-1')
  })
})
