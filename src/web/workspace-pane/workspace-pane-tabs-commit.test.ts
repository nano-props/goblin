// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import {
  commitWorkspacePaneTabs,
  updateWorkspacePaneTabs,
  workspacePaneTabsInteractionBlockedForTarget,
} from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import {
  createRepoBranch,
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import {
  clearWorkspacePaneTabsProjectionState,
  readWorkspacePaneTabsForTarget,
  refreshWorkspacePaneTabsQueryData,
  setWorkspacePaneTabsForTargetQueryData,
  workspacePaneTabsQueryOptions,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsEntry } from '#/shared/workspace-pane-tabs.ts'

const REPO_ROOT = '/tmp/workspace-pane-tabs-commit-repo'
const REPO_RUNTIME_ID = 'repo-runtime-test'
const NEXT_REPO_RUNTIME_ID = 'repo-runtime-next'
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/tmp/workspace-pane-tabs-commit-worktree'

beforeEach(() => {
  resetReposStore()
  seedWorkspacePaneTabsRepo(REPO_RUNTIME_ID)
})

afterEach(() => {
  resetReposStore()
  setClientBridgeForTests(null)
})

describe('commitWorkspacePaneTabs', () => {
  test('blocks target interaction while a commit is in flight', async () => {
    let resolveServerTabs!: (tabs: WorkspacePaneTabEntry[]) => void
    const serverTabs = new Promise<WorkspacePaneTabEntry[]>((resolve) => {
      resolveServerTabs = resolve
    })
    installWorkspacePaneTabsTestBridge({
      replaceWorkspaceTabs: async () => await serverTabs,
    })

    const commit = commitWorkspacePaneTabs({
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    expect(workspacePaneTabsInteractionBlocked()).toBe(true)
    resolveServerTabs([workspacePaneStaticTabEntry('status')])
    await expect(commit).resolves.toMatchObject({ ok: true })
    expect(workspacePaneTabsInteractionBlocked()).toBe(false)
  })

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
      repoRuntimeId: REPO_RUNTIME_ID,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('history')],
    })

    const commit = commitWorkspacePaneTabs({
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [
        workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        workspacePaneStaticTabEntry('status'),
      ],
    })

    expect(readWorkspacePaneTabs()).toEqual([workspacePaneStaticTabEntry('history')])

    resolveServerTabs([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
    ])
    await expect(commit).resolves.toMatchObject({ ok: true })
    expect(readWorkspacePaneTabs()).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
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
      repoRuntimeId: REPO_RUNTIME_ID,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    await expect(
      commitWorkspacePaneTabs({
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('history')],
      }),
    ).resolves.toMatchObject({ ok: false })

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

    const fetch = primaryWindowQueryClient
      .fetchQuery(workspacePaneTabsQueryOptions(REPO_ROOT, REPO_RUNTIME_ID))
      .catch(() => null)

    await expect(
      commitWorkspacePaneTabs({
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
          workspacePaneStaticTabEntry('status'),
        ],
      }),
    ).resolves.toMatchObject({ ok: true })

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
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneStaticTabEntry('status'),
    ])
  })

  test('cancels list queries that start while a commit is in flight before writing committed tabs', async () => {
    let resolveServerTabs!: (tabs: WorkspacePaneTabEntry[]) => void
    const serverTabs = new Promise<WorkspacePaneTabEntry[]>((resolve) => {
      resolveServerTabs = resolve
    })
    let resolveListTabs!: (tabs: WorkspacePaneTabsEntry[]) => void
    const listTabs = new Promise<WorkspacePaneTabsEntry[]>((resolve) => {
      resolveListTabs = resolve
    })
    let markReplaceStarted!: () => void
    const replaceStarted = new Promise<void>((resolve) => {
      markReplaceStarted = resolve
    })
    installWorkspacePaneTabsTestBridge({
      listWorkspaceTabs: async () => await listTabs,
      replaceWorkspaceTabs: async () => {
        markReplaceStarted()
        return await serverTabs
      },
    })

    const commit = commitWorkspacePaneTabs({
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [
        workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        workspacePaneStaticTabEntry('status'),
      ],
    })
    await replaceStarted
    const fetch = primaryWindowQueryClient
      .fetchQuery(workspacePaneTabsQueryOptions(REPO_ROOT, REPO_RUNTIME_ID))
      .catch(() => null)

    resolveServerTabs([
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneStaticTabEntry('status'),
    ])
    await expect(commit).resolves.toMatchObject({ ok: true })
    resolveListTabs([
      {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('history')],
      },
    ])
    await fetch

    expect(readWorkspacePaneTabs()).toEqual([
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneStaticTabEntry('status'),
    ])
  })

  test('ignores a stale manual refresh that resolves after committed tabs are written', async () => {
    let resolveListTabs!: (tabs: WorkspacePaneTabsEntry[]) => void
    const listTabs = new Promise<WorkspacePaneTabsEntry[]>((resolve) => {
      resolveListTabs = resolve
    })
    installWorkspacePaneTabsTestBridge({
      listWorkspaceTabs: async () => await listTabs,
      replaceWorkspaceTabs: async (input) => [...input.tabs],
    })

    const refresh = refreshWorkspacePaneTabsQueryData(REPO_ROOT, REPO_RUNTIME_ID)
    await Promise.resolve()

    await expect(
      commitWorkspacePaneTabs({
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
          workspacePaneStaticTabEntry('status'),
        ],
      }),
    ).resolves.toMatchObject({ ok: true })

    resolveListTabs([
      {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('history')],
      },
    ])
    await refresh

    expect(readWorkspacePaneTabs()).toEqual([
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      workspacePaneStaticTabEntry('status'),
    ])
  })

  test('keeps stale refresh suppressed after projection bookkeeping is cleared and recreated', async () => {
    let resolveOldListTabs!: (tabs: WorkspacePaneTabsEntry[]) => void
    let resolveNewListTabs!: (tabs: WorkspacePaneTabsEntry[]) => void
    const oldListTabs = new Promise<WorkspacePaneTabsEntry[]>((resolve) => {
      resolveOldListTabs = resolve
    })
    const newListTabs = new Promise<WorkspacePaneTabsEntry[]>((resolve) => {
      resolveNewListTabs = resolve
    })
    const listResponses = [oldListTabs, newListTabs]
    installWorkspacePaneTabsTestBridge({
      listWorkspaceTabs: async () => await listResponses.shift()!,
      replaceWorkspaceTabs: async (input) => [...input.tabs],
    })

    const oldRefresh = refreshWorkspacePaneTabsQueryData(REPO_ROOT, REPO_RUNTIME_ID)
    await Promise.resolve()
    clearWorkspacePaneTabsProjectionState(REPO_ROOT, REPO_RUNTIME_ID)
    const newRefresh = refreshWorkspacePaneTabsQueryData(REPO_ROOT, REPO_RUNTIME_ID)
    await Promise.resolve()

    resolveNewListTabs([
      {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('status')],
      },
    ])
    await newRefresh

    resolveOldListTabs([
      {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('history')],
      },
    ])
    await oldRefresh

    expect(readWorkspacePaneTabs()).toEqual([workspacePaneStaticTabEntry('status')])
  })
})

describe('updateWorkspacePaneTabs', () => {
  test('does not block target interaction for open-static updates', async () => {
    let resolveServerTabs!: (tabs: WorkspacePaneTabEntry[]) => void
    const serverTabs = new Promise<WorkspacePaneTabEntry[]>((resolve) => {
      resolveServerTabs = resolve
    })
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async () => await serverTabs,
    })

    const update = updateWorkspacePaneTabs({
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      operation: { type: 'open-static', tabType: 'history' },
    })

    expect(workspacePaneTabsInteractionBlocked()).toBe(false)
    resolveServerTabs([workspacePaneStaticTabEntry('history')])
    await expect(update).resolves.toMatchObject({ ok: true })
    expect(workspacePaneTabsInteractionBlocked()).toBe(false)
  })

  test('sends a server operation and writes canonical server tabs', async () => {
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async (input) => {
        expect(input.operation).toEqual({ type: 'open-static', tabType: 'history' })
        return [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')]
      },
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    await expect(
      updateWorkspacePaneTabs({
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: { type: 'open-static', tabType: 'history' },
      }),
    ).resolves.toMatchObject({ ok: true })

    expect(readWorkspacePaneTabs()).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('history'),
    ])
  })

  test('passes through open-static insertion hints', async () => {
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async (input) => {
        expect(input.operation).toEqual({
          type: 'open-static',
          tabType: 'history',
          insertAfterIdentity: 'workspace-pane:status',
        })
        return [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')]
      },
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    await expect(
      updateWorkspacePaneTabs({
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: {
          type: 'open-static',
          tabType: 'history',
          insertAfterIdentity: 'workspace-pane:status',
        },
      }),
    ).resolves.toMatchObject({ ok: true })

    expect(readWorkspacePaneTabs()).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('history'),
    ])
  })

  test('returns a failure result and leaves cached tabs untouched when the server operation fails', async () => {
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async () => {
        throw new Error('server unavailable')
      },
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    await expect(
      updateWorkspacePaneTabs({
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: { type: 'open-static', tabType: 'history' },
      }),
    ).resolves.toMatchObject({ ok: false })

    expect(readWorkspacePaneTabs()).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('does not accept server tabs after the repo runtime changes', async () => {
    let resolveServerTabs!: (tabs: WorkspacePaneTabEntry[]) => void
    let markUpdateStarted!: () => void
    const updateStarted = new Promise<void>((resolve) => {
      markUpdateStarted = resolve
    })
    const serverTabs = new Promise<WorkspacePaneTabEntry[]>((resolve) => {
      resolveServerTabs = resolve
    })
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async () => {
        markUpdateStarted()
        return await serverTabs
      },
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    const update = updateWorkspacePaneTabs({
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      operation: { type: 'open-static', tabType: 'history' },
    })
    await updateStarted

    seedWorkspacePaneTabsRepo(NEXT_REPO_RUNTIME_ID)
    resolveServerTabs([workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')])

    await expect(update).resolves.toMatchObject({ ok: true, projectionApplied: false })
    expect(readWorkspacePaneTabs()).toEqual([workspacePaneStaticTabEntry('status')])
  })
})

function readWorkspacePaneTabs(): WorkspacePaneTabEntry[] {
  return readWorkspacePaneTabsForTarget({
    repoRoot: REPO_ROOT,
    repoRuntimeId: REPO_RUNTIME_ID,
    branchName: BRANCH_NAME,
    worktreePath: WORKTREE_PATH,
  })
}

function workspacePaneTabsInteractionBlocked(): boolean {
  return workspacePaneTabsInteractionBlockedForTarget({
    repoRoot: REPO_ROOT,
    branchName: BRANCH_NAME,
    worktreePath: WORKTREE_PATH,
  })
}

function seedWorkspacePaneTabsRepo(repoRuntimeId: string): void {
  seedRepoWithReadModelForTest({
    id: REPO_ROOT,
    repoRuntimeId,
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: BRANCH_NAME,
  })
}
