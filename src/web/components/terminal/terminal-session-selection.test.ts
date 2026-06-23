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
    const isValid = (_worktreeKey: string, key: string) => ['slot-1', 'slot-2', 'slot-3'].includes(key)
    const sortedDescriptors = [descriptor('slot-1'), descriptor('slot-2'), descriptor('slot-3')]

    expect(
      resolveSelectedTerminalKey({
        worktreeTerminalKey: 'repo\0wt',
        preferredKey: 'slot-3',
        currentKey: 'slot-2',
        controllerKey: 'slot-1',
        sortedDescriptors,
        isSelectedKeyValid: isValid,
      }),
    ).toBe('slot-3')

    expect(
      resolveSelectedTerminalKey({
        worktreeTerminalKey: 'repo\0wt',
        preferredKey: 'missing',
        currentKey: 'slot-2',
        controllerKey: 'slot-1',
        sortedDescriptors,
        isSelectedKeyValid: isValid,
      }),
    ).toBe('slot-2')

    expect(
      resolveSelectedTerminalKey({
        worktreeTerminalKey: 'repo\0wt',
        preferredKey: null,
        currentKey: null,
        controllerKey: 'slot-1',
        sortedDescriptors,
        isSelectedKeyValid: isValid,
      }),
    ).toBe('slot-1')

    expect(
      resolveSelectedTerminalKey({
        worktreeTerminalKey: 'repo\0wt',
        preferredKey: null,
        currentKey: null,
        controllerKey: null,
        sortedDescriptors,
        isSelectedKeyValid: isValid,
      }),
    ).toBe('slot-1')
  })
})
