import { describe, expect, test } from 'vitest'
import { resolveSelectedTerminalKey } from '#/web/components/terminal/terminal-session-selection.ts'
import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'

function descriptor(key: string): TerminalDescriptor {
  return {
    key,
    worktreeTerminalKey: 'repo\0wt',
    terminalId: key,
    index: 1,
    repoRoot: '/repo',
    branch: 'main',
    worktreePath: '/repo',
  }
}

describe('terminal session selection helper', () => {
  test('prefers preferred selection, then current, then controller, then first terminal', () => {
    const isValid = (_worktreeKey: string, key: string) => ['terminal-1', 'terminal-2', 'terminal-3'].includes(key)
    const sortedDescriptors = [descriptor('terminal-1'), descriptor('terminal-2'), descriptor('terminal-3')]

    expect(
      resolveSelectedTerminalKey({
        worktreeTerminalKey: 'repo\0wt',
        preferredKey: 'terminal-3',
        currentKey: 'terminal-2',
        controllerKey: 'terminal-1',
        sortedDescriptors,
        isSelectedKeyValid: isValid,
      }),
    ).toBe('terminal-3')

    expect(
      resolveSelectedTerminalKey({
        worktreeTerminalKey: 'repo\0wt',
        preferredKey: 'missing',
        currentKey: 'terminal-2',
        controllerKey: 'terminal-1',
        sortedDescriptors,
        isSelectedKeyValid: isValid,
      }),
    ).toBe('terminal-2')

    expect(
      resolveSelectedTerminalKey({
        worktreeTerminalKey: 'repo\0wt',
        preferredKey: null,
        currentKey: null,
        controllerKey: 'terminal-1',
        sortedDescriptors,
        isSelectedKeyValid: isValid,
      }),
    ).toBe('terminal-1')

    expect(
      resolveSelectedTerminalKey({
        worktreeTerminalKey: 'repo\0wt',
        preferredKey: null,
        currentKey: null,
        controllerKey: null,
        sortedDescriptors,
        isSelectedKeyValid: isValid,
      }),
    ).toBe('terminal-1')
  })
})
