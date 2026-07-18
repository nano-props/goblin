import { describe, expect, test } from 'vitest'
import { terminalSessionTargetWorktreePath } from '#/server/terminal/terminal-session-scope.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const workspaceId = canonicalWorkspaceLocator('goblin+file:///tmp/workspace')!

describe('terminal session target worktree path', () => {
  test('derives a workspace-root execution path from its authoritative locator', () => {
    expect(
      terminalSessionTargetWorktreePath({
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
    expect(terminalSessionTargetWorktreePath(target)).toBe('/tmp/worktree')
  })
})
