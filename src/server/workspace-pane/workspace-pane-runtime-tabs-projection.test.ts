// @vitest-environment node

import { describe, expect, test } from 'vitest'
import { workspaceRuntimeTabWorktreePaths } from '#/server/workspace-pane/workspace-pane-runtime-tabs-projection.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const WORKSPACE_ID = canonicalWorkspaceLocator('goblin+file:///repo')!
const WORKTREE_ROOT = canonicalWorkspaceLocator('goblin+file:///repo/worktree')!
const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'

describe('workspace pane runtime tabs projection', () => {
  test('collects native worktree execution paths without reconstructing target identity', () => {
    expect(
      workspaceRuntimeTabWorktreePaths({
        entries: [
          {
            target: {
              kind: 'git-worktree',
              workspaceId: WORKSPACE_ID,
              workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
              root: WORKTREE_ROOT,
            },
            tabs: [],
          },
        ],
        providerSnapshots: [
          {
            type: 'terminal',
            revision: 1,
            liveSessions: [
              {
                sessionId: 'term-livelivelivelivelive1',
                target: {
                  kind: 'git-worktree',
                  workspaceId: WORKSPACE_ID,
                  workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
                  root: canonicalWorkspaceLocator('goblin+file:///repo/other')!,
                },
                branch: 'feature/other',
                worktreePath: '/repo/other',
              },
            ],
          },
        ],
      }),
    ).toEqual(['/repo/worktree', '/repo/other'])
  })

  test('fast-fails a worktree target from a different transport', () => {
    expect(() =>
      workspaceRuntimeTabWorktreePaths({
        entries: [
          {
            target: {
              kind: 'git-worktree',
              workspaceId: WORKSPACE_ID,
              workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
              root: canonicalWorkspaceLocator('goblin+ssh://server/repo/worktree')!,
            },
            tabs: [],
          },
        ],
        providerSnapshots: [],
      }),
    ).toThrow('error.workspace-tabs-target-invalid')
  })
})
