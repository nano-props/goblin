// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import { createWorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import { createWorkspacePaneTabsRuntime } from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'

const USER_ID = 'user-workspace-pane-tabs'
const REPO_ROOT = '/repo'
const SCOPE = 'repo-instance-scope'
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/repo/worktree'

describe('workspace pane tabs coordinator', () => {
  test('materializes live runtime sessions when listing workspace tabs', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const broadcastChanged = vi.fn()
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      runtimeProviders: [
        {
          type: 'terminal',
          listSessionsForUser: vi.fn(async () => [
            { sessionId: 'session-live', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
          ]),
        },
      ],
    })

    await expect(
      coordinator.listWorkspaceTabs({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        scope: SCOPE,
        assertCurrent: () => {},
        broadcastChanged,
      }),
    ).resolves.toEqual([
      {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'session-live')],
      },
    ])
    expect(broadcastChanged).toHaveBeenCalledOnce()
  })

  test('prunes stale runtime tabs when replacing workspace tabs', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      runtimeProviders: [
        {
          type: 'terminal',
          listSessionsForUser: vi.fn(async () => [
            { sessionId: 'session-live', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
          ]),
        },
      ],
    })

    await expect(
      coordinator.replaceTabs({
        userId: USER_ID,
        scope: SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [
          workspacePaneRuntimeTabEntry('terminal', 'session-stale'),
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'session-live'),
        ],
        assertCurrent: () => {},
      }),
    ).resolves.toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'session-live'),
    ])
  })
})
