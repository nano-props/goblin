// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import {
  acquireWorkspaceRuntime,
  clearWorkspaceRuntimesForUser,
  isCurrentWorkspaceRuntime,
} from '#/server/modules/workspace-runtimes.ts'
import { createWorkspacePaneTabsActions } from '#/server/workspace-pane/workspace-pane-tabs-actions.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { formatWorkspaceLocator } from '#/shared/workspace-locator.ts'

const CLIENT_ID = 'client_workspace_pane_tabs_actions'
const USER_ID = 'user_workspace_pane_tabs_actions'
const WORKSPACE_ID = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: '/repo' }, 'posix')!
const OTHER_WORKSPACE_ID = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: '/other' }, 'posix')!
const REPO_ROOT = WORKSPACE_ID
let WORKSPACE_RUNTIME_ID = ''

function syncCurrentWorkspaceRuntime(): void {
  WORKSPACE_RUNTIME_ID = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, CLIENT_ID)
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
      isCurrentWorkspaceRuntime: isCurrentWorkspaceRuntime,
    }),
    sessionService,
  }
}

describe('workspace-pane-tabs-actions', () => {
  test('lists workspace tabs through the workspace-pane service boundary', async () => {
    clearWorkspaceRuntimesForUser(USER_ID)
    syncCurrentWorkspaceRuntime()
    const { actions, sessionService } = makeActions()

    await expect(
      actions.listWorkspaceTabs(CLIENT_ID, USER_ID, {
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
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

    expect(sessionService.listWorkspaceTabs).toHaveBeenCalledWith(USER_ID, REPO_ROOT, WORKSPACE_RUNTIME_ID)
  })

  test('delegates replaceTabs after validation succeeds', async () => {
    clearWorkspaceRuntimesForUser(USER_ID)
    syncCurrentWorkspaceRuntime()
    const { actions, sessionService } = makeActions()

    await expect(
      actions.replaceTabs(CLIENT_ID, USER_ID, {
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        target: runtimeTarget(),
        tabs: [workspacePaneStaticTabEntry('status')],
      }),
    ).resolves.toMatchObject({ revision: 2 })

    expect(sessionService.replaceTabs).toHaveBeenCalledOnce()
  })

  test('delegates updateTabs after validation succeeds', async () => {
    clearWorkspaceRuntimesForUser(USER_ID)
    syncCurrentWorkspaceRuntime()
    const { actions, sessionService } = makeActions()

    await expect(
      actions.updateTabs(CLIENT_ID, USER_ID, {
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        target: runtimeTarget(),
        operation: { type: 'open-static', tabType: 'status' },
      }),
    ).resolves.toMatchObject({ revision: 3 })

    expect(sessionService.updateTabs).toHaveBeenCalledOnce()
  })

  test('rejects a replaceTabs input whose target belongs to another workspace', async () => {
    clearWorkspaceRuntimesForUser(USER_ID)
    syncCurrentWorkspaceRuntime()
    const { actions, sessionService } = makeActions()

    await expect(
      actions.replaceTabs(CLIENT_ID, USER_ID, {
        workspaceId: OTHER_WORKSPACE_ID,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        target: runtimeTarget(),
        tabs: [workspacePaneStaticTabEntry('status')],
      }),
    ).resolves.toEqual({ revision: 0, entries: [] })

    expect(sessionService.replaceTabs).not.toHaveBeenCalled()
  })

  test('rejects stale workspace runtimes before touching workspace tab state', async () => {
    clearWorkspaceRuntimesForUser(USER_ID)
    syncCurrentWorkspaceRuntime()
    const { actions, sessionService } = makeActions()

    await expect(
      actions.updateTabs(CLIENT_ID, USER_ID, {
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: 'repo-runtime-stale',
        target: { ...runtimeTarget(), workspaceRuntimeId: 'repo-runtime-stale' },
        operation: { type: 'open-static', tabType: 'status' },
      }),
    ).rejects.toThrow('error.workspace-runtime-stale')

    expect(sessionService.updateTabs).not.toHaveBeenCalled()
  })

  test('rejects invalid client ids before touching workspace tab state', async () => {
    clearWorkspaceRuntimesForUser(USER_ID)
    syncCurrentWorkspaceRuntime()
    const { actions, sessionService } = makeActions()

    await expect(
      actions.listWorkspaceTabs('not_a_client', USER_ID, {
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      }),
    ).resolves.toEqual({ revision: 0, entries: [] })

    expect(sessionService.listWorkspaceTabs).not.toHaveBeenCalled()
  })
})

function runtimeTarget() {
  return {
    kind: 'git-worktree' as const,
    workspaceId: WORKSPACE_ID,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    root: WORKSPACE_ID,
  }
}
