import { describe, expect, test } from 'vitest'
import { terminalSessionTargetExecutionPath } from '#/server/terminal/terminal-session-scope.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const workspaceId = canonicalWorkspaceLocator('goblin+file:///tmp/workspace')!

describe('terminal session target execution path', () => {
  test('derives a workspace-root execution path from its authoritative locator', () => {
    expect(
      terminalSessionTargetExecutionPath({
        kind: 'workspace-root',
        workspaceId,
        workspaceRuntimeId: 'repo-runtime-current',
      }),
    ).toBe('/tmp/workspace')
  })

  test('derives a Git worktree execution path from its authoritative target root', () => {
    const target = {
      kind: 'git-worktree' as const,
      workspaceId,
      workspaceRuntimeId: 'repo-runtime-current',
      root: canonicalWorkspaceLocator('goblin+file:///tmp/worktree')!,
    }
    expect(terminalSessionTargetExecutionPath(target)).toBe('/tmp/worktree')
  })
})
