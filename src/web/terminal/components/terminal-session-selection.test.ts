import { describe, expect, test } from 'vitest'
import { resolveSelectedTerminalSessionId } from '#/web/terminal/components/terminal-session-selection.ts'
import type { TerminalDescriptor } from '#/web/terminal/components/types.ts'
import { terminalDescriptorForTest } from '#/web/test-utils/terminal-model.ts'

const FIRST = 'term-111111111111111111111'
const SECOND = 'term-222222222222222222222'
const THIRD = 'term-333333333333333333333'

function descriptor(terminalSessionId: string): TerminalDescriptor {
  return terminalDescriptorForTest({
    terminalSessionId,
    index: 1,
    repoRoot: '/repo',
    workspaceRuntimeId: 'repo-runtime-test',
    branch: 'main',
    worktreePath: '/repo',
  })
}

describe('terminal session selection helper', () => {
  const sortedDescriptors = [descriptor(FIRST), descriptor(SECOND), descriptor(THIRD)]
  const validIds = new Set([FIRST, SECOND, THIRD])

  test.each([
    { name: 'uses a valid preferred selection', preferred: THIRD, current: SECOND, controller: FIRST, expected: THIRD },
    {
      name: 'uses the current selection when the preference is invalid',
      preferred: 'missing',
      current: SECOND,
      controller: FIRST,
      expected: SECOND,
    },
    {
      name: 'uses the controller when no client selection exists',
      preferred: null,
      current: null,
      controller: FIRST,
      expected: FIRST,
    },
    {
      name: 'uses the first terminal when no selection exists',
      preferred: null,
      current: null,
      controller: null,
      expected: FIRST,
    },
  ])('$name', ({ preferred, current, controller, expected }) => {
    expect(
      resolveSelectedTerminalSessionId({
        terminalFilesystemTargetKey: 'terminal-target-test',
        preferredSessionId: preferred,
        currentSessionId: current,
        controllerSessionId: controller,
        sortedDescriptors,
        isSelectedTerminalSessionIdValid: (_targetKey, terminalSessionId) => validIds.has(terminalSessionId),
      }),
    ).toBe(expected)
  })
})
