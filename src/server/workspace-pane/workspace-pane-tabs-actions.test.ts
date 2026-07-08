// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import {
  clearRepoRuntimesForUser,
  isCurrentRepoRuntime,
  openRepoRuntime,
} from '#/server/modules/repo-runtimes.ts'
import { createWorkspacePaneTabsActions } from '#/server/workspace-pane/workspace-pane-tabs-actions.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'

const CLIENT_ID = 'client_workspace_pane_tabs_actions'
const USER_ID = 'user_workspace_pane_tabs_actions'
const REPO_ROOT = '/repo'
let REPO_RUNTIME_ID = ''

function syncCurrentRepoRuntime(): void {
  REPO_RUNTIME_ID = openRepoRuntime(USER_ID, REPO_ROOT)
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
      isCurrentRepoRuntime: isCurrentRepoRuntime,
      broadcastWorkspaceTabsChanged: broadcasts as unknown as (userId: string, repoRoot: string) => void,
    }),
    broadcasts,
    sessionService,
  }
}

describe('workspace-pane-tabs-actions', () => {
  test('lists workspace tabs through the workspace-pane service boundary', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, sessionService } = makeActions()

    await expect(
      actions.listWorkspaceTabs(CLIENT_ID, USER_ID, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
      }),
    ).resolves.toEqual([
      {
        repoRoot: REPO_ROOT,
        branchName: 'feature/worktree',
        worktreePath: '/repo',
        tabs: [workspacePaneStaticTabEntry('status')],
      },
    ])

    expect(sessionService.listWorkspaceTabs).toHaveBeenCalledWith(USER_ID, REPO_ROOT, REPO_RUNTIME_ID)
  })

  test('emits a workspace tabs invalidation after replaceTabs succeeds', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, broadcasts } = makeActions()

    await expect(
      actions.replaceTabs(CLIENT_ID, USER_ID, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: 'feature/worktree',
        worktreePath: '/repo',
        tabs: [workspacePaneStaticTabEntry('status')],
      }),
    ).resolves.toEqual([workspacePaneStaticTabEntry('status')])

    expect(broadcasts).toHaveBeenCalledTimes(1)
    expect(broadcasts).toHaveBeenCalledWith(USER_ID, REPO_ROOT)
  })

  test('emits a workspace tabs invalidation after updateTabs succeeds', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, broadcasts } = makeActions()

    await expect(
      actions.updateTabs(CLIENT_ID, USER_ID, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: 'feature/worktree',
        worktreePath: '/repo',
        operation: { type: 'open-static', tabType: 'status' },
      }),
    ).resolves.toEqual([workspacePaneStaticTabEntry('history')])

    expect(broadcasts).toHaveBeenCalledTimes(1)
    expect(broadcasts).toHaveBeenCalledWith(USER_ID, REPO_ROOT)
  })

  test('rejects invalid replaceTabs input without emitting', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, broadcasts, sessionService } = makeActions()

    await expect(
      actions.replaceTabs(CLIENT_ID, USER_ID, {
        repoRoot: '',
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: 'feature/worktree',
        worktreePath: '/repo',
        tabs: [workspacePaneStaticTabEntry('status')],
      }),
    ).resolves.toEqual([])

    expect(sessionService.replaceTabs).not.toHaveBeenCalled()
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('rejects stale repo runtimes before touching workspace tab state', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, broadcasts, sessionService } = makeActions()

    await expect(
      actions.updateTabs(CLIENT_ID, USER_ID, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: 'repo-runtime-stale',
        branchName: 'feature/worktree',
        worktreePath: '/repo',
        operation: { type: 'open-static', tabType: 'status' },
      }),
    ).rejects.toThrow('error.repo-runtime-stale')

    expect(sessionService.updateTabs).not.toHaveBeenCalled()
    expect(broadcasts).not.toHaveBeenCalled()
  })

  test('rejects invalid client ids before touching workspace tab state', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, broadcasts, sessionService } = makeActions()

    await expect(
      actions.listWorkspaceTabs('not_a_client', USER_ID, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
      }),
    ).resolves.toEqual([])

    expect(sessionService.listWorkspaceTabs).not.toHaveBeenCalled()
    expect(broadcasts).not.toHaveBeenCalled()
  })
})
