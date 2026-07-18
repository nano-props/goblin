import { describe, expect, test } from 'vitest'
import {
  terminalExecutionCoordinates,
  terminalExecutionPath,
  type TerminalExecutionTarget,
} from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

describe('terminal execution target projections', () => {
  test.each([
    ['goblin+file:///repo', 'goblin+file:///repo/worktree', '/repo/worktree'],
    ['goblin+ssh://dev/srv/repo', 'goblin+ssh://dev/srv/repo/worktree', '/srv/repo/worktree'],
  ])('keeps %s identity separate from its execution path', (workspace, worktree, executionPath) => {
    const target: TerminalExecutionTarget = {
      kind: 'git-worktree',
      workspaceId: requiredWorkspaceLocator(workspace),
      workspaceRuntimeId: 'workspace-runtime-test',
      root: requiredWorkspaceLocator(worktree),
    }

    expect(terminalExecutionCoordinates(target)).toEqual({
      repoRoot: workspace,
      workspaceRuntimeId: 'workspace-runtime-test',
      worktreeId: worktree,
    })
    expect(terminalExecutionPath(target)).toBe(executionPath)
  })
})

function requiredWorkspaceLocator(input: string) {
  const locator = canonicalWorkspaceLocator(input)
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}
