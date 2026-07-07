// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import {
  clearRepoRuntimeInstancesForUser,
  isCurrentRepoRuntimeInstance,
  openRepoRuntimeInstance,
} from '#/server/modules/repo-runtime-instances.ts'
import { createWorkspacePaneTabsActions } from '#/server/workspace-pane/workspace-pane-tabs-actions.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'

const CLIENT_ID = 'client_workspace_pane_tabs_actions'
const USER_ID = 'user_workspace_pane_tabs_actions'
const REPO_ROOT = '/repo'
let REPO_INSTANCE_ID = ''

function syncCurrentRepoInstance(): void {
  REPO_INSTANCE_ID = openRepoRuntimeInstance(USER_ID, REPO_ROOT)
}

function makeActions(
  options: {
    isValidClientId?: (value: unknown) => value is string
    broadcasts?: ReturnType<typeof vi.fn>
  } = {},
) {
  const broadcasts = options.broadcasts ?? vi.fn()
  const sessionService = {
    listWorkspaceTabs: vi.fn(async () => [
      {
        repoRoot: REPO_ROOT,
        branchName: 'feature/worktree',
        worktreePath: '/repo',
        tabs: [workspacePaneStaticTabEntry('status')],
      },
    ]),
    replaceTabs: vi.fn(async (userId, input) => input.tabs),
    updateTabs: vi.fn(async () => [workspacePaneStaticTabEntry('history')]),
  }
  const isValidClientId = options.isValidClientId ?? ((value: unknown): value is string => value === CLIENT_ID)

  return {
    actions: createWorkspacePaneTabsActions({
      sessionService,
      isValidClientId,
      isCurrentRepoInstance: isCurrentRepoRuntimeInstance,
      broadcastWorkspaceTabsChanged: broadcasts as unknown as (userId: string, repoRoot: string) => void,
    }),
    broadcasts,
    sessionService,
  }
}

describe('workspace-pane-tabs-actions', () => {
  test('lists workspace tabs through the workspace-pane service boundary', async () => {
    clearRepoRuntimeInstancesForUser(USER_ID)
    syncCurrentRepoInstance()
    const { actions, sessionService } = makeActions()

    await expect(
      actions.listWorkspaceTabs(CLIENT_ID, USER_ID, {
        repoRoot: REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
      }),
    ).resolves.toEqual([
      {
        repoRoot: REPO_ROOT,
        branchName: 'feature/worktree',
        worktreePath: '/repo',
        tabs: [workspacePaneStaticTabEntry('status')],
      },
    ])

    expect(sessionService.listWorkspaceTabs).toHaveBeenCalledWith(USER_ID, REPO_ROOT, REPO_INSTANCE_ID)
  })

  test('emits a workspace tabs invalidation after replaceTabs succeeds', async () => {
    clearRepoRuntimeInstancesForUser(USER_ID)
    syncCurrentRepoInstance()
    const { actions, broadcasts } = makeActions()

    await expect(
      actions.replaceTabs(CLIENT_ID, USER_ID, {
        repoRoot: REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
        branchName: 'feature/worktree',
        worktreePath: '/repo',
        tabs: [workspacePaneStaticTabEntry('status')],
      }),
    ).resolves.toEqual([workspacePaneStaticTabEntry('status')])

    expect(broadcasts).toHaveBeenCalledTimes(1)
    expect(broadcasts).toHaveBeenCalledWith(USER_ID, REPO_ROOT)
  })

  test('emits a workspace tabs invalidation after updateTabs succeeds', async () => {
    clearRepoRuntimeInstancesForUser(USER_ID)
    syncCurrentRepoInstance()
    const { actions, broadcasts } = makeActions()

    await expect(
      actions.updateTabs(CLIENT_ID, USER_ID, {
        repoRoot: REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
        branchName: 'feature/worktree',
        worktreePath: '/repo',
        operation: { type: 'open-static', tabType: 'status' },
      }),
    ).resolves.toEqual([workspacePaneStaticTabEntry('history')])

    expect(broadcasts).toHaveBeenCalledTimes(1)
    expect(broadcasts).toHaveBeenCalledWith(USER_ID, REPO_ROOT)
  })

  test('rejects invalid replaceTabs input without emitting', async () => {
    clearRepoRuntimeInstancesForUser(USER_ID)
    syncCurrentRepoInstance()
    const { actions, broadcasts, sessionService } = makeActions()

    await expect(
      actions.replaceTabs(CLIENT_ID, USER_ID, {
        repoRoot: '',
        repoInstanceId: REPO_INSTANCE_ID,
        branchName: 'feature/worktree',
        worktreePath: '/repo',
        tabs: [workspacePaneStaticTabEntry('status')],
      }),
    ).resolves.toEqual([])

    expect(sessionService.replaceTabs).not.toHaveBeenCalled()
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('rejects stale repo instances before touching workspace tab state', async () => {
    clearRepoRuntimeInstancesForUser(USER_ID)
    syncCurrentRepoInstance()
    const { actions, broadcasts, sessionService } = makeActions()

    await expect(
      actions.updateTabs(CLIENT_ID, USER_ID, {
        repoRoot: REPO_ROOT,
        repoInstanceId: 'repo-instance-stale',
        branchName: 'feature/worktree',
        worktreePath: '/repo',
        operation: { type: 'open-static', tabType: 'status' },
      }),
    ).rejects.toThrow('error.repo-instance-stale')

    expect(sessionService.updateTabs).not.toHaveBeenCalled()
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('rejects invalid client ids before touching workspace tab state', async () => {
    clearRepoRuntimeInstancesForUser(USER_ID)
    syncCurrentRepoInstance()
    const { actions, broadcasts, sessionService } = makeActions()

    await expect(
      actions.listWorkspaceTabs('not_a_client', USER_ID, {
        repoRoot: REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
      }),
    ).resolves.toEqual([])

    expect(sessionService.listWorkspaceTabs).not.toHaveBeenCalled()
    expect(broadcasts).not.toHaveBeenCalled()
  })
})
