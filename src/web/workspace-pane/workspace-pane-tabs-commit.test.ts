// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { commitWorkspacePaneTabs, updateWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { installWorkspacePaneTabsTestBridge, resetReposStore } from '#/web/test-utils/bridge.ts'
import {
  readWorkspacePaneTabsForTarget,
  setWorkspacePaneTabsForTargetQueryData,
  workspacePaneTabsQueryOptions,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsEntry } from '#/shared/terminal-types.ts'
import { clearWorkspacePaneTabsOperationQueuesForTests } from '#/web/workspace-pane/workspace-pane-tabs-operation-queue.ts'

const REPO_ROOT = '/tmp/workspace-pane-tabs-commit-repo'
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/tmp/workspace-pane-tabs-commit-worktree'

beforeEach(() => {
  clearWorkspacePaneTabsOperationQueuesForTests()
  resetReposStore()
})

afterEach(() => {
  clearWorkspacePaneTabsOperationQueuesForTests()
  resetReposStore()
  setClientBridgeForTests(null)
})

describe('commitWorkspacePaneTabs', () => {
  test('writes canonical server tabs after a successful commit', async () => {
    let resolveServerTabs!: (tabs: WorkspacePaneTabEntry[]) => void
    const serverTabs = new Promise<WorkspacePaneTabEntry[]>((resolve) => {
      resolveServerTabs = resolve
    })
    installWorkspacePaneTabsTestBridge({
      replaceWorkspaceTabs: async () => await serverTabs,
    })

    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: REPO_ROOT,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('history')],
    })

    const commit = commitWorkspacePaneTabs({
      repoRoot: REPO_ROOT,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneTerminalTabEntry('session-1'), workspacePaneStaticTabEntry('status')],
    })

    expect(readWorkspacePaneTabs()).toEqual([workspacePaneStaticTabEntry('history')])

    resolveServerTabs([workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-1')])
    await expect(commit).resolves.toBe(true)
    expect(readWorkspacePaneTabs()).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneTerminalTabEntry('session-1'),
    ])
  })

  test('leaves cached tabs untouched when a commit fails', async () => {
    installWorkspacePaneTabsTestBridge({
      replaceWorkspaceTabs: async () => {
        throw new Error('server unavailable')
      },
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: REPO_ROOT,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    await expect(
      commitWorkspacePaneTabs({
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('history')],
      }),
    ).resolves.toBe(false)

    expect(readWorkspacePaneTabs()).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('cancels stale in-flight list queries before writing committed tabs', async () => {
    let resolveListTabs!: (tabs: WorkspacePaneTabsEntry[]) => void
    const listTabs = new Promise<WorkspacePaneTabsEntry[]>((resolve) => {
      resolveListTabs = resolve
    })
    installWorkspacePaneTabsTestBridge({
      listWorkspaceTabs: async () => await listTabs,
      replaceWorkspaceTabs: async (input) => [...input.tabs],
    })

    const fetch = primaryWindowQueryClient.fetchQuery(workspacePaneTabsQueryOptions(REPO_ROOT)).catch(() => null)

    await expect(
      commitWorkspacePaneTabs({
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneTerminalTabEntry('session-1'), workspacePaneStaticTabEntry('status')],
      }),
    ).resolves.toBe(true)

    resolveListTabs([
      {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('status')],
      },
    ])
    await fetch

    expect(readWorkspacePaneTabs()).toEqual([
      workspacePaneTerminalTabEntry('session-1'),
      workspacePaneStaticTabEntry('status'),
    ])
  })
})

describe('updateWorkspacePaneTabs', () => {
  test('sends a server operation and writes canonical server tabs', async () => {
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async (input) => {
        expect(input.operation).toEqual({ type: 'open-static', tabType: 'history' })
        return [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')]
      },
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: REPO_ROOT,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    await expect(
      updateWorkspacePaneTabs({
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: { type: 'open-static', tabType: 'history' },
      }),
    ).resolves.toBe(true)

    expect(readWorkspacePaneTabs()).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('history'),
    ])
  })

  test('returns false and leaves cached tabs untouched when the server operation fails', async () => {
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async () => {
        throw new Error('server unavailable')
      },
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: REPO_ROOT,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    await expect(
      updateWorkspacePaneTabs({
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: { type: 'open-static', tabType: 'history' },
      }),
    ).resolves.toBe(false)

    expect(readWorkspacePaneTabs()).toEqual([workspacePaneStaticTabEntry('status')])
  })
})

function readWorkspacePaneTabs(): WorkspacePaneTabEntry[] {
  return readWorkspacePaneTabsForTarget({
    repoRoot: REPO_ROOT,
    branchName: BRANCH_NAME,
    worktreePath: WORKTREE_PATH,
  })
}
