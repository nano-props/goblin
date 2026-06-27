import { describe, expect, test } from 'vitest'
import { resolveSelectedTerminalKey } from '#/web/components/terminal/terminal-session-selection.ts'
import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'

function descriptor(key: string): TerminalDescriptor {
  return {
    key,
    worktreeTerminalKey: 'repo\0wt',
    slotId: key,
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
        preferredKey: 'session-3',
        currentKey: 'session-2',
        controllerKey: 'session-1',
        sortedDescriptors,
        isSelectedKeyValid: isValid,
      }),
    ).toBe('session-3')

    expect(
      resolveSelectedTerminalKey({
        worktreeTerminalKey: 'repo\0wt',
        preferredKey: 'missing',
        currentKey: 'session-2',
        controllerKey: 'session-1',
        sortedDescriptors,
        isSelectedKeyValid: isValid,
      }),
    ).toBe('session-2')

    expect(
      resolveSelectedTerminalKey({
        worktreeTerminalKey: 'repo\0wt',
        preferredKey: null,
        currentKey: null,
        controllerKey: 'session-1',
        sortedDescriptors,
        isSelectedKeyValid: isValid,
      }),
    ).toBe('session-1')

    expect(
      resolveSelectedTerminalKey({
        worktreeTerminalKey: 'repo\0wt',
        preferredKey: null,
        currentKey: null,
        controllerKey: null,
        sortedDescriptors,
        isSelectedKeyValid: isValid,
      }),
    ).toBe('session-1')
  })
})
