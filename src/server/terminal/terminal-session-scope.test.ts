import { describe, expect, test } from 'vitest'
import { terminalSessionTargetWorktreePath } from '#/server/terminal/terminal-session-scope.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const workspaceId = canonicalWorkspaceLocator('goblin+file:///tmp/workspace')!

describe('terminal session target worktree path', () => {
  test('derives a workspace-root execution path from its authoritative locator', () => {
    expect(
      terminalSessionTargetWorktreePath(
        {
          kind: 'workspace-root',
          workspaceId,
          workspaceRuntimeId: 'repo-runtime-current',
        },
        'goblin+file:///tmp/workspace',
      ),
    ).toBe('/tmp/workspace')
  })

  test('continues to validate a Git worktree path against its target root', () => {
    const target = {
      kind: 'git-worktree' as const,
      workspaceId,
      workspaceRuntimeId: 'repo-runtime-current',
      root: canonicalWorkspaceLocator('goblin+file:///tmp/worktree')!,
    }
    expect(terminalSessionTargetWorktreePath(target, '/tmp/worktree')).toBe('/tmp/worktree')
    expect(terminalSessionTargetWorktreePath(target, '/tmp/other')).toBeNull()
  })
})
