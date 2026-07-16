// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import { acquireRepoRuntime, clearRepoRuntimesForUser, isCurrentRepoRuntime } from '#/server/modules/repo-runtimes.ts'
import { createWorkspacePaneTabsActions } from '#/server/workspace-pane/workspace-pane-tabs-actions.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { formatWorkspaceLocator } from '#/shared/workspace-locator.ts'

const CLIENT_ID = 'client_workspace_pane_tabs_actions'
const USER_ID = 'user_workspace_pane_tabs_actions'
const REPO_ROOT = 'goblin+file:///repo'
const WORKSPACE_ID = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: '/repo' }, 'posix')!
let REPO_RUNTIME_ID = ''

function syncCurrentRepoRuntime(): void {
  REPO_RUNTIME_ID = acquireRepoRuntime(USER_ID, REPO_ROOT, CLIENT_ID)
}

function makeActions(
  options: {
    isValidClientId?: (value: unknown) => value is string
  } = {},
) {
  const listedSnapshot = {
    revision: 1,
    entries: [
      {
        target: runtimeTarget(),
        tabs: [workspacePaneStaticTabEntry('status')],
      },
    ],
  }
  const replacedSnapshot = { revision: 2, entries: listedSnapshot.entries }
  const updatedSnapshot = {
    revision: 3,
    entries: [{ ...listedSnapshot.entries[0], tabs: [workspacePaneStaticTabEntry('history')] }],
  }
  const sessionService = {
    listWorkspaceTabs: vi.fn(async () => listedSnapshot),
    replaceTabs: vi.fn(async () => replacedSnapshot),
    updateTabs: vi.fn(async () => updatedSnapshot),
  }
  const isValidClientId = options.isValidClientId ?? ((value: unknown): value is string => value === CLIENT_ID)

  return {
    actions: createWorkspacePaneTabsActions({
      sessionService,
      isValidClientId,
      isCurrentRepoRuntime: isCurrentRepoRuntime,
    }),
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
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: REPO_RUNTIME_ID,
      }),
    ).resolves.toEqual({
      revision: 1,
      entries: [
        {
          target: runtimeTarget(),
          tabs: [workspacePaneStaticTabEntry('status')],
        },
      ],
    })

    expect(sessionService.listWorkspaceTabs).toHaveBeenCalledWith(USER_ID, REPO_ROOT, REPO_RUNTIME_ID)
  })

  test('delegates replaceTabs after validation succeeds', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, sessionService } = makeActions()

    await expect(
      actions.replaceTabs(CLIENT_ID, USER_ID, {
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: REPO_RUNTIME_ID,
        target: runtimeTarget(),
        tabs: [workspacePaneStaticTabEntry('status')],
      }),
    ).resolves.toMatchObject({ revision: 2 })

    expect(sessionService.replaceTabs).toHaveBeenCalledOnce()
  })

  test('delegates updateTabs after validation succeeds', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, sessionService } = makeActions()

    await expect(
      actions.updateTabs(CLIENT_ID, USER_ID, {
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: REPO_RUNTIME_ID,
        target: runtimeTarget(),
        operation: { type: 'open-static', tabType: 'status' },
      }),
    ).resolves.toMatchObject({ revision: 3 })

    expect(sessionService.updateTabs).toHaveBeenCalledOnce()
  })

  test('rejects invalid replaceTabs input without emitting', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, sessionService } = makeActions()

    await expect(
      actions.replaceTabs(CLIENT_ID, USER_ID, {
        workspaceId: '',
        workspaceRuntimeId: REPO_RUNTIME_ID,
        target: runtimeTarget(),
        tabs: [workspacePaneStaticTabEntry('status')],
      }),
    ).resolves.toEqual({ revision: 0, entries: [] })

    expect(sessionService.replaceTabs).not.toHaveBeenCalled()
  })

  test('rejects stale repo runtimes before touching workspace tab state', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, sessionService } = makeActions()

    await expect(
      actions.updateTabs(CLIENT_ID, USER_ID, {
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: 'repo-runtime-stale',
        target: { ...runtimeTarget(), workspaceRuntimeId: 'repo-runtime-stale' },
        operation: { type: 'open-static', tabType: 'status' },
      }),
    ).rejects.toThrow('error.repo-runtime-stale')

    expect(sessionService.updateTabs).not.toHaveBeenCalled()
  })

  test('rejects invalid client ids before touching workspace tab state', async () => {
    clearRepoRuntimesForUser(USER_ID)
    syncCurrentRepoRuntime()
    const { actions, sessionService } = makeActions()

    await expect(
      actions.listWorkspaceTabs('not_a_client', USER_ID, {
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: REPO_RUNTIME_ID,
      }),
    ).resolves.toEqual({ revision: 0, entries: [] })

    expect(sessionService.listWorkspaceTabs).not.toHaveBeenCalled()
  })
})

function runtimeTarget() {
  return {
    kind: 'git-worktree' as const,
    workspaceId: WORKSPACE_ID,
    workspaceRuntimeId: REPO_RUNTIME_ID,
    root: WORKSPACE_ID,
  }
}
