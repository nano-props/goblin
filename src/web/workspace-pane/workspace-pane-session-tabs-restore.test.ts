// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { restoreServerWorkspacePaneTabsFromSession } from '#/web/workspace-pane/workspace-pane-session-tabs-restore.ts'
import {
  createRepoBranch,
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import * as workspacePaneTabsCommit from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'

const REPO_ID = '/tmp/workspace-pane-session-tabs-restore-repo'
const WORKTREE_PATH = '/tmp/workspace-pane-session-tabs-restore-worktree'

beforeEach(() => {
  resetReposStore()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetReposStore()
  setClientBridgeForTests(null)
})

describe('restoreServerWorkspacePaneTabsFromSession', () => {
  test('commits restored worktree tabs through the terminal client and applies canonical server tabs', async () => {
    seedRepo()
    installWorkspacePaneTabsTestBridge({
      replaceWorkspaceTabs: async () => [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
      ],
    })

    await expect(
      restoreServerWorkspacePaneTabsFromSession({
        [REPO_ID]: {
          [worktreeTargetKey()]: [
            workspacePaneStaticTabEntry('status'),
            workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
          ],
        },
      }),
    ).resolves.toMatchObject({ status: 'restored' })

    expect(readTabsFor('feature/worktree', WORKTREE_PATH)).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
    ])
  })

  test('commits restored no-worktree branch tabs with a null worktree target', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      workspacePaneTabsByBranch: {
        'feature/no-worktree': [workspacePaneStaticTabEntry('status')],
      },
    })
    const replaceWorkspaceTabs = vi.fn(async () => [workspacePaneStaticTabEntry('status')])
    installWorkspacePaneTabsTestBridge({ replaceWorkspaceTabs })

    await expect(
      restoreServerWorkspacePaneTabsFromSession({
        [REPO_ID]: {
          [branchTargetKey('feature/no-worktree')]: [
            workspacePaneStaticTabEntry('status'),
            workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
          ],
        },
      }),
    ).resolves.toMatchObject({ status: 'restored' })

    expect(replaceWorkspaceTabs).toHaveBeenCalledWith({
      repoRoot: REPO_ID,
      repoRuntimeId: useReposStore.getState().repos[REPO_ID]!.repoRuntimeId,
      branchName: 'feature/no-worktree',
      worktreePath: null,
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
      ],
    })
    expect(readTabsFor('feature/no-worktree', null)).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('does not retarget an explicit branch target to a worktree target', async () => {
    seedRepo()
    const replaceWorkspaceTabs = vi.fn(async () => [workspacePaneStaticTabEntry('history')])
    installWorkspacePaneTabsTestBridge({ replaceWorkspaceTabs })

    await expect(
      restoreServerWorkspacePaneTabsFromSession({
        [REPO_ID]: {
          [branchTargetKey('feature/worktree')]: [workspacePaneStaticTabEntry('history')],
        },
      }),
    ).resolves.toMatchObject({ status: 'restored' })

    expect(replaceWorkspaceTabs).toHaveBeenCalledWith({
      repoRoot: REPO_ID,
      repoRuntimeId: useReposStore.getState().repos[REPO_ID]!.repoRuntimeId,
      branchName: 'feature/worktree',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('history')],
    })
    expect(readTabsFor('feature/worktree', null)).toEqual([workspacePaneStaticTabEntry('history')])
    expect(readTabsFor('feature/worktree', WORKTREE_PATH)).toEqual([workspacePaneStaticTabEntry('status')])
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
          [worktreeTargetKey()]: [workspacePaneStaticTabEntry('history')],
        },
      }),
    ).resolves.toMatchObject({ status: 'failed', failedCommits: [expect.objectContaining({ ok: false })] })

    expect(readTabsFor('feature/worktree', WORKTREE_PATH)).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('does not treat an older unprojected server response as a restore failure', async () => {
    seedRepo()
    vi.spyOn(workspacePaneTabsCommit, 'commitWorkspacePaneTabs').mockResolvedValue({
      ok: true,
      projectionApplied: false,
    })

    await expect(
      restoreServerWorkspacePaneTabsFromSession({
        [REPO_ID]: {
          [worktreeTargetKey()]: [workspacePaneStaticTabEntry('history')],
        },
      }),
    ).resolves.toMatchObject({ status: 'restored', failedCommits: [] })
  })

  test('fails restore when a persisted repo is not loaded', async () => {
    installWorkspacePaneTabsTestBridge({
      replaceWorkspaceTabs: async () => [workspacePaneStaticTabEntry('history')],
    })

    await expect(
      restoreServerWorkspacePaneTabsFromSession({
        [REPO_ID]: {
          [worktreeTargetKey()]: [workspacePaneStaticTabEntry('history')],
        },
      }),
    ).resolves.toMatchObject({ status: 'failed', unresolvedRepos: [REPO_ID] })
  })

  test('fails restore when a persisted target no longer resolves', async () => {
    seedRepo()
    const replaceWorkspaceTabs = vi.fn(async () => [workspacePaneStaticTabEntry('history')])
    installWorkspacePaneTabsTestBridge({ replaceWorkspaceTabs })

    await expect(
      restoreServerWorkspacePaneTabsFromSession({
        [REPO_ID]: {
          [branchTargetKey('feature/missing')]: [workspacePaneStaticTabEntry('history')],
        },
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      unresolvedTargets: [{ repoRoot: REPO_ID, targetKey: branchTargetKey('feature/missing') }],
    })

    expect(replaceWorkspaceTabs).not.toHaveBeenCalled()
  })

  test('returns cancelled without committing when the restore signal is already aborted', async () => {
    seedRepo()
    const replaceWorkspaceTabs = vi.fn(async () => [workspacePaneStaticTabEntry('history')])
    installWorkspacePaneTabsTestBridge({ replaceWorkspaceTabs })
    const controller = new AbortController()
    controller.abort()

    await expect(
      restoreServerWorkspacePaneTabsFromSession(
        {
          [REPO_ID]: {
            [worktreeTargetKey()]: [workspacePaneStaticTabEntry('history')],
          },
        },
        { signal: controller.signal },
      ),
    ).resolves.toMatchObject({ status: 'cancelled' })

    expect(replaceWorkspaceTabs).not.toHaveBeenCalled()
    expect(readTabsFor('feature/worktree', WORKTREE_PATH)).toEqual([workspacePaneStaticTabEntry('status')])
  })
})

function seedRepo(): void {
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: 'feature/worktree',
    workspacePaneTabsByBranch: {
      'feature/worktree': [workspacePaneStaticTabEntry('status')],
    },
  })
}

function readTabsFor(branchName: string, worktreePath: string | null) {
  return readWorkspacePaneTabsForTarget({
    repoRoot: REPO_ID,
    repoRuntimeId: useReposStore.getState().repos[REPO_ID]!.repoRuntimeId,
    branchName,
    worktreePath,
  })
}

function worktreeTargetKey(): string {
  return workspacePaneTabsTargetIdentityKey({
    repoRoot: REPO_ID,
    branchName: 'feature/worktree',
    worktreePath: WORKTREE_PATH,
  })
}

function branchTargetKey(branchName: string): string {
  return workspacePaneTabsTargetIdentityKey({ repoRoot: REPO_ID, branchName, worktreePath: null })
}
