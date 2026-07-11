// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  commitWorkspacePaneTabs,
  updateWorkspacePaneTabs,
  workspacePaneTabsInteractionBlockedForTarget,
  writeCanonicalWorkspacePaneTabsSnapshot,
} from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import {
  createRepoBranch,
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'

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
  vi.restoreAllMocks()
  resetReposStore()
  setClientBridgeForTests(null)
})

describe('commitWorkspacePaneTabs', () => {
  test('blocks target interaction while a commit is in flight', async () => {
    const serverTabs = Promise.withResolvers<WorkspacePaneTabEntry[]>()
    installWorkspacePaneTabsTestBridge({ replaceWorkspaceTabs: async () => await serverTabs.promise })

    const commit = commitWorkspacePaneTabs({
      ...target(),
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    expect(workspacePaneTabsInteractionBlocked()).toBe(true)
    serverTabs.resolve([workspacePaneStaticTabEntry('status')])
    await expect(commit).resolves.toMatchObject({ ok: true, projectionApplied: true })
    expect(workspacePaneTabsInteractionBlocked()).toBe(false)
  })

  test('writes the complete canonical server snapshot after a successful commit', async () => {
    installWorkspacePaneTabsTestBridge({
      replaceWorkspaceTabs: async () => [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      ],
    })
    seedTabs([workspacePaneStaticTabEntry('history')])

    await expect(
      commitWorkspacePaneTabs({
        ...target(),
        tabs: [workspacePaneStaticTabEntry('status')],
      }),
    ).resolves.toMatchObject({ ok: true, projectionApplied: true })

    expect(readTabs()).toEqual([
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
    seedTabs([workspacePaneStaticTabEntry('status')])

    await expect(
      commitWorkspacePaneTabs({ ...target(), tabs: [workspacePaneStaticTabEntry('history')] }),
    ).resolves.toMatchObject({ ok: false })
    expect(readTabs()).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('rejects a lower-revision canonical response', () => {
    expect(
      writeCanonicalWorkspacePaneTabsSnapshot(
        REPO_ROOT,
        REPO_RUNTIME_ID,
        snapshot(9, [workspacePaneStaticTabEntry('history')]),
      ),
    ).toBe(true)
    expect(
      writeCanonicalWorkspacePaneTabsSnapshot(
        REPO_ROOT,
        REPO_RUNTIME_ID,
        snapshot(8, [workspacePaneStaticTabEntry('status')]),
      ),
    ).toBe(false)

    expect(readTabs()).toEqual([workspacePaneStaticTabEntry('history')])
  })
})

describe('updateWorkspacePaneTabs', () => {
  test('does not block target interaction for open-static updates', async () => {
    const serverTabs = Promise.withResolvers<WorkspacePaneTabEntry[]>()
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs: async () => await serverTabs.promise })

    const update = updateWorkspacePaneTabs({
      ...target(),
      operation: { type: 'open-static', tabType: 'history' },
    })

    expect(workspacePaneTabsInteractionBlocked()).toBe(false)
    serverTabs.resolve([workspacePaneStaticTabEntry('history')])
    await expect(update).resolves.toMatchObject({ ok: true })
    expect(workspacePaneTabsInteractionBlocked()).toBe(false)
  })

  test('passes the operation through and applies its canonical snapshot', async () => {
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
    seedTabs([workspacePaneStaticTabEntry('status')])

    await expect(
      updateWorkspacePaneTabs({
        ...target(),
        operation: {
          type: 'open-static',
          tabType: 'history',
          insertAfterIdentity: 'workspace-pane:status',
        },
      }),
    ).resolves.toMatchObject({ ok: true, projectionApplied: true })
    expect(readTabs()).toEqual([workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')])
  })

  test('returns failure and preserves cache when the server operation fails', async () => {
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async () => {
        throw new Error('server unavailable')
      },
    })
    seedTabs([workspacePaneStaticTabEntry('status')])

    await expect(
      updateWorkspacePaneTabs({
        ...target(),
        operation: { type: 'open-static', tabType: 'history' },
      }),
    ).resolves.toMatchObject({ ok: false })
    expect(readTabs()).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('does not project a successful response after repoRuntimeId changes', async () => {
    const serverTabs = Promise.withResolvers<WorkspacePaneTabEntry[]>()
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs: async () => await serverTabs.promise })
    seedTabs([workspacePaneStaticTabEntry('status')])

    const update = updateWorkspacePaneTabs({
      ...target(),
      operation: { type: 'open-static', tabType: 'history' },
    })
    await Promise.resolve()
    seedWorkspacePaneTabsRepo(NEXT_REPO_RUNTIME_ID)
    serverTabs.resolve([workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')])

    await expect(update).resolves.toMatchObject({ ok: true, projectionApplied: false })
    expect(readTabs()).toEqual([workspacePaneStaticTabEntry('status')])
  })
})

function target() {
  return {
    repoRoot: REPO_ROOT,
    repoRuntimeId: REPO_RUNTIME_ID,
    branchName: BRANCH_NAME,
    worktreePath: WORKTREE_PATH,
  }
}

function seedTabs(tabs: WorkspacePaneTabEntry[]): void {
  setWorkspacePaneTabsForTargetQueryData({ ...target(), tabs })
}

function readTabs(): WorkspacePaneTabEntry[] {
  return readWorkspacePaneTabsForTarget(target())
}

function workspacePaneTabsInteractionBlocked(): boolean {
  return workspacePaneTabsInteractionBlockedForTarget(target())
}

function snapshot(revision: number, tabs: WorkspacePaneTabEntry[]): WorkspacePaneTabsSnapshot {
  return {
    revision,
    entries: [{ repoRoot: REPO_ROOT, branchName: BRANCH_NAME, worktreePath: WORKTREE_PATH, tabs }],
  }
}

function seedWorkspacePaneTabsRepo(repoRuntimeId: string): void {
  seedRepoWithReadModelForTest({
    id: REPO_ROOT,
    repoRuntimeId,
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: BRANCH_NAME,
  })
}
