// @vitest-environment jsdom

import { resetWorkspacesStore, seedRepoWithReadModelForTest, createRepoBranch } from '#/web/test-utils/repo-store.ts'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  updateWorkspacePaneTabs,
  workspacePaneTabsInteractionBlockedForTarget,
  writeCanonicalWorkspacePaneTabsSnapshot,
} from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { installWorkspacePaneTabsTestBridge } from '#/web/test-utils/workspace-pane-bridge.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  runtimeWorkspacePaneTargetForTest,
  setWorkspacePaneTabsForTargetQueryData,
} from '#/web/test-utils/workspace-pane-tabs.ts'
import { createWorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { workspacePaneTabTargetBlocksInteraction } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { workspacePaneTabsClient } from '#/web/workspace-pane/workspace-pane-tabs-client.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const REPO_ROOT = workspaceIdForTest('goblin+file:///tmp/workspace-pane-tabs-commit-repo')
const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'
const NEXT_WORKSPACE_RUNTIME_ID = 'repo-runtime-next'
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/tmp/workspace-pane-tabs-commit-worktree'

beforeEach(() => {
  resetWorkspacesStore()
  seedWorkspacePaneTabsRepo(WORKSPACE_RUNTIME_ID)
})

afterEach(() => {
  vi.restoreAllMocks()
  resetWorkspacesStore()
  setClientBridgeForTests(null)
})

describe('workspace pane tabs canonical projection', () => {
  test('rejects a lower-revision canonical response', () => {
    expect(
      writeCanonicalWorkspacePaneTabsSnapshot(
        REPO_ROOT,
        WORKSPACE_RUNTIME_ID,
        snapshot(9, [workspacePaneStaticTabEntry('history')]),
      ),
    ).toBe('applied')
    expect(
      writeCanonicalWorkspacePaneTabsSnapshot(
        REPO_ROOT,
        WORKSPACE_RUNTIME_ID,
        snapshot(8, [workspacePaneStaticTabEntry('status')]),
      ),
    ).toBe('newer-snapshot-preserved')

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
    ).resolves.toEqual({ ok: true, projection: 'applied' })
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

  test('preserves a committed projection failure without changing cached tabs', async () => {
    vi.spyOn(workspacePaneTabsClient, 'update').mockResolvedValue({ kind: 'committed-projection-failed' })
    seedTabs([workspacePaneStaticTabEntry('status')])

    await expect(
      updateWorkspacePaneTabs({
        ...target(),
        operation: { type: 'open-static', tabType: 'history' },
      }),
    ).resolves.toEqual({ ok: true, projection: 'failed' })
    expect(readTabs()).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('preserves a newer global snapshot without treating the action presentation as superseded', async () => {
    writeCanonicalWorkspacePaneTabsSnapshot(REPO_ROOT, WORKSPACE_RUNTIME_ID, {
      revision: 9,
      entries: [
        ...snapshot(9, [workspacePaneStaticTabEntry('history'), workspacePaneStaticTabEntry('files')]).entries,
        {
          target: runtimeWorkspacePaneTargetForTest({
            kind: 'workspace-root',
            workspaceId: REPO_ROOT,
            workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
          }),
          tabs: [workspacePaneStaticTabEntry('files')],
        },
      ],
    })
    vi.spyOn(workspacePaneTabsClient, 'update').mockResolvedValue({
      kind: 'projected',
      snapshot: snapshot(8, [workspacePaneStaticTabEntry('history')]),
    })

    await expect(
      updateWorkspacePaneTabs({
        ...target(),
        operation: { type: 'open-static', tabType: 'history' },
      }),
    ).resolves.toEqual({ ok: true, projection: 'applied' })
    expect(readTabs()).toEqual([workspacePaneStaticTabEntry('history'), workspacePaneStaticTabEntry('files')])
  })

  test('does not project a successful response after workspaceRuntimeId changes', async () => {
    const serverTabs = Promise.withResolvers<WorkspacePaneTabEntry[]>()
    const requestStarted = Promise.withResolvers<void>()
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async () => {
        requestStarted.resolve()
        return await serverTabs.promise
      },
    })
    seedTabs([workspacePaneStaticTabEntry('status')])

    const update = updateWorkspacePaneTabs({
      ...target(),
      operation: { type: 'open-static', tabType: 'history' },
    })
    await requestStarted.promise
    seedWorkspacePaneTabsRepo(NEXT_WORKSPACE_RUNTIME_ID)
    serverTabs.resolve([workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')])

    await expect(update).resolves.toEqual({ ok: true, projection: 'superseded' })
    expect(readTabs()).toEqual([workspacePaneStaticTabEntry('status')])
  })
})

function target() {
  return {
    kind: 'git-worktree' as const,
    workspaceId: REPO_ROOT,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
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
    entries: [
      {
        target: runtimeWorkspacePaneTargetForTest({
          kind: 'git-worktree' as const,
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
          worktreePath: WORKTREE_PATH,
        }),
        tabs,
      },
    ],
  }
}

function seedWorkspacePaneTabsRepo(workspaceRuntimeId: string): void {
  seedRepoWithReadModelForTest({
    id: REPO_ROOT,
    workspaceRuntimeId,
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } })],
    currentBranchName: BRANCH_NAME,
  })
}
