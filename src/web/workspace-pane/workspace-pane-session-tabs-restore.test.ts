// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { restoreServerWorkspacePaneTabsFromSession } from '#/web/workspace-pane/workspace-pane-session-tabs-restore.ts'
import {
  createRepoBranch,
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
  seedRepoState,
} from '#/web/test-utils/bridge.ts'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'
import { readWorkspacePaneTabsForBranch } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

const REPO_ID = '/tmp/workspace-pane-session-tabs-restore-repo'
const WORKTREE_PATH = '/tmp/workspace-pane-session-tabs-restore-worktree'

beforeEach(() => {
  resetReposStore()
})

afterEach(() => {
  resetReposStore()
  setClientBridgeForTests(null)
})

describe('restoreServerWorkspacePaneTabsFromSession', () => {
  test('commits restored worktree tabs through the terminal bridge and applies canonical server tabs', async () => {
    seedRepo()
    installWorkspacePaneTabsTestBridge({
      replaceWorkspaceTabs: async () => [
        workspacePaneStaticTabEntry('status'),
        workspacePaneTerminalTabEntry('session-live'),
      ],
    })

    await expect(
      restoreServerWorkspacePaneTabsFromSession({
        [REPO_ID]: {
          'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-stale')],
        },
      }),
    ).resolves.toBe(true)

    expect(readWorkspacePaneTabsForBranch(REPO_ID, 'feature/worktree')).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneTerminalTabEntry('session-live'),
    ])
  })

  test('commits restored no-worktree branch tabs with a null worktree target', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      workspacePaneTabsByBranch: {
        'feature/no-worktree': [workspacePaneStaticTabEntry('status')],
      },
    })
    const replaceWorkspaceTabs = vi.fn(async () => [workspacePaneStaticTabEntry('status')])
    installWorkspacePaneTabsTestBridge({ replaceWorkspaceTabs })

    await expect(
      restoreServerWorkspacePaneTabsFromSession({
        [REPO_ID]: {
          'feature/no-worktree': [
            workspacePaneStaticTabEntry('status'),
            workspacePaneTerminalTabEntry('session-stale'),
          ],
        },
      }),
    ).resolves.toBe(true)

    expect(replaceWorkspaceTabs).toHaveBeenCalledWith({
      repoRoot: REPO_ID,
      branchName: 'feature/no-worktree',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-stale')],
    })
    expect(readWorkspacePaneTabsForBranch(REPO_ID, 'feature/no-worktree')).toEqual([
      workspacePaneStaticTabEntry('status'),
    ])
  })

  test('reports failure without applying local restored tabs when the server commit fails', async () => {
    seedRepo()
    installWorkspacePaneTabsTestBridge({
      replaceWorkspaceTabs: async () => {
        throw new Error('server unavailable')
      },
    })

    await expect(
      restoreServerWorkspacePaneTabsFromSession({
        [REPO_ID]: {
          'feature/worktree': [workspacePaneStaticTabEntry('history')],
        },
      }),
    ).resolves.toBe(false)

    expect(readWorkspacePaneTabsForBranch(REPO_ID, 'feature/worktree')).toEqual([
      workspacePaneStaticTabEntry('status'),
    ])
  })
})

function seedRepo(): void {
  seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    selectedBranch: 'feature/worktree',
    workspacePaneTabsByBranch: {
      'feature/worktree': [workspacePaneStaticTabEntry('status')],
    },
  })
}
