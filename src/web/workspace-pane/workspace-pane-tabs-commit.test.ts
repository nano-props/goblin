// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { commitWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import {
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
} from '#/web/test-utils/bridge.ts'
import {
  readWorkspacePaneTabsForBranch,
  workspacePaneTabsQueryOptions,
  workspacePaneTabsQueryKey,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsEntry } from '#/shared/terminal-types.ts'

const REPO_ROOT = '/tmp/workspace-pane-tabs-commit-repo'
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/tmp/workspace-pane-tabs-commit-worktree'

beforeEach(() => {
  resetReposStore()
})

afterEach(() => {
  resetReposStore()
  setClientBridgeForTests(null)
})

describe('commitWorkspacePaneTabs', () => {
  test('optimistically applies reorder tabs and then replaces them with canonical server tabs', async () => {
    let resolveServerTabs!: (tabs: WorkspacePaneTabEntry[]) => void
    const serverTabs = new Promise<WorkspacePaneTabEntry[]>((resolve) => {
      resolveServerTabs = resolve
    })
    installWorkspacePaneTabsTestBridge({
      replaceWorkspaceTabs: async () => await serverTabs,
    })

    const commit = commitWorkspacePaneTabs({
      repoRoot: REPO_ROOT,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneTerminalTabEntry('session-1'), workspacePaneStaticTabEntry('status')],
      optimistic: true,
    })

    expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME)).toEqual([
      workspacePaneTerminalTabEntry('session-1'),
      workspacePaneStaticTabEntry('status'),
    ])

    resolveServerTabs([workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-1')])
    await expect(commit).resolves.toBe(true)
    expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME)).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneTerminalTabEntry('session-1'),
    ])
  })

  test('invalidates workspace pane tabs when an optimistic commit fails', async () => {
    installWorkspacePaneTabsTestBridge({
      replaceWorkspaceTabs: async () => {
        throw new Error('server unavailable')
      },
    })

    await expect(
      commitWorkspacePaneTabs({
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('history')],
        optimistic: true,
      }),
    ).resolves.toBe(false)

    expect(primaryWindowQueryClient.getQueryState(workspacePaneTabsQueryKey(REPO_ROOT))?.isInvalidated).toBe(true)
  })

  test('cancels stale in-flight list queries before applying an optimistic commit', async () => {
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
        optimistic: true,
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

    expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME)).toEqual([
      workspacePaneTerminalTabEntry('session-1'),
      workspacePaneStaticTabEntry('status'),
    ])
  })
})
