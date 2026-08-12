import { describe, expect, test, vi } from 'vitest'
import {
  acquireWorkspaceRuntime,
  closeWorkspaceRuntimesForDurableRemoval,
  type WorkspaceRuntimeEpochCapability,
} from '#/server/modules/workspace-runtimes.ts'
import {
  WORKSPACE_PANE_TABS_REALTIME_EVENTS,
  WORKSPACE_PANE_TABS_SOCKET_ACTIONS,
} from '#/shared/workspace-pane-tabs.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import {
  LINKED_REPO_ROOT,
  REPO_ROOT,
  SSH_WORKSPACE_RUNTIME_ID,
  USER_1,
  USER_2,
  USER_2_WORKSPACE_RUNTIME_ID,
  WORKSPACE_RUNTIME_ID,
  appRealtimeSocket,
  buildRuntime,
  commitTerminalReadyProbe,
  createAdmittedTerminal,
  createLocalWorktreeTerminal,
  requestWorkspacePaneTabs,
  requiredWorkspaceLocator,
  resolveRemoteTargetMock,
  sentSocketMessages,
  setTestWorkspacePaneLayout,
  setTestWorkspacePaneLayoutWriteError,
  testWorkspacePaneLayout,
  testWorkspacePaneLayoutWriteError,
  workspacePaneTabsListInput,
  workspacePaneWorktreeTarget,
} from '#/server/test-utils/terminal-runtime.ts'

function workspaceRuntimeCapability(assertCurrent: () => void = () => {}): WorkspaceRuntimeEpochCapability {
  return {
    userId: USER_1,
    workspaceId: REPO_ROOT,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    isCurrent: () => {
      try {
        assertCurrent()
        return true
      } catch {
        return false
      }
    },
    assertCurrent,
  }
}

describe('server terminal runtime workspace panes', () => {
  test('broadcasts an accepted durable pane layout change to every active user projection', async () => {
    const { host, shutdown } = await buildRuntime()
    const socketA = appRealtimeSocket()
    const socketB = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socketA)
    host.registerSocket('client_b', USER_2, socketB)

    await requestWorkspacePaneTabs(
      host,
      socketA,
      WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
      workspacePaneTabsListInput(WORKSPACE_RUNTIME_ID),
      'req_list_user_a',
    )
    await requestWorkspacePaneTabs(
      host,
      socketB,
      WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
      workspacePaneTabsListInput(USER_2_WORKSPACE_RUNTIME_ID),
      'req_list_user_b',
      { clientId: 'client_b', userId: USER_2 },
    )
    socketA.send.mockClear()
    socketB.send.mockClear()

    await requestWorkspacePaneTabs(
      host,
      socketA,
      WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
      {
        ...workspacePaneTabsListInput(WORKSPACE_RUNTIME_ID),
        target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
        operation: { type: 'open-static', tabType: 'history' },
      },
      'req_update_user_a',
    )

    await vi.waitFor(() => {
      expect(
        sentSocketMessages(socketA).some((message) => message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed),
      ).toBe(true)
      expect(
        sentSocketMessages(socketB).some((message) => message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed),
      ).toBe(true)
    })

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client_b', USER_2, socketB)
    shutdown()
  })

  test('returns created terminal sessions for SSH remote repositories', async () => {
    const { host, shutdown } = await buildRuntime()
    const result = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: 'goblin+ssh://prod/srv/repo',
      workspaceRuntimeId: SSH_WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/srv/repo',
      kind: 'primary',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(resolveRemoteTargetMock).not.toHaveBeenCalled()
    expect(result.terminalSessionId).toMatch(/^term-[A-Za-z0-9_-]{21}$/)
    expect(result).not.toHaveProperty('sessions')
    await expect(
      host.listSessions('client_a', USER_1, {
        workspaceId: requiredWorkspaceLocator('goblin+ssh://prod/srv/repo'),
        workspaceRuntimeId: SSH_WORKSPACE_RUNTIME_ID,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        terminalSessionId: result.terminalSessionId,
        target: expect.objectContaining({
          kind: 'git-worktree',
          workspaceId: requiredWorkspaceLocator('goblin+ssh://prod/srv/repo'),
          root: 'goblin+ssh://prod/srv/repo',
        }),
      }),
    ])

    shutdown()
  })

  test('reuses the existing terminal when reopening the same repo root', async () => {
    const { host, shutdown } = await buildRuntime()
    const first = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'primary')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.action).toBe('created')
    const second = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'primary')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.action).toBe('reused')
    expect(second.terminalSessionId).toBe(first.terminalSessionId)

    shutdown()
  })

  test('workspace runtime close drops runtime state while preserving durable layout for the reopened epoch', async () => {
    const { host, shutdown } = await buildRuntime()
    const first = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'primary')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const socket = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socket)
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket,
        WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
        {
          ...workspacePaneTabsListInput(WORKSPACE_RUNTIME_ID),
          target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
          operation: { type: 'open-static', tabType: 'history' },
        },
        'req_update_before_repo_close',
      ),
    ).resolves.toMatchObject({
      kind: 'projected',
      snapshot: {
        entries: [
          {
            tabs: [
              { type: 'status', tabId: 'workspace-pane:status' },
              { type: 'terminal', runtimeSessionId: first.terminalSessionId },
              { type: 'history', tabId: 'workspace-pane:history' },
            ],
          },
        ],
      },
    })
    socket.send.mockClear()

    expect(closeWorkspaceRuntimesForDurableRemoval(REPO_ROOT)).toBe(2)
    await vi.waitFor(() => {
      expect(
        sentSocketMessages(socket).filter((message) => message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed),
      ).toHaveLength(1)
    })
    expect(sentSocketMessages(socket).filter((message) => message.type === 'sessions-changed')).toHaveLength(1)
    const nextWorkspaceRuntimeId = acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_a')
    await commitTerminalReadyProbe(USER_1, REPO_ROOT, nextWorkspaceRuntimeId)

    await expect(
      host.listSessions('client_a', USER_1, { workspaceId: REPO_ROOT, workspaceRuntimeId: nextWorkspaceRuntimeId }),
    ).resolves.toEqual([])
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket,
        WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
        workspacePaneTabsListInput(nextWorkspaceRuntimeId),
        'req_list_after_repo_reopen',
      ),
    ).resolves.toMatchObject({
      entries: [
        {
          target: workspacePaneWorktreeTarget(nextWorkspaceRuntimeId),
          tabs: [
            { type: 'status', tabId: 'workspace-pane:status' },
            { type: 'history', tabId: 'workspace-pane:history' },
          ],
        },
      ],
    })

    const second = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: nextWorkspaceRuntimeId,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.action).toBe('created')
    expect(second.terminalSessionId).not.toBe(first.terminalSessionId)

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('Git capability removal clears Git-scoped sessions and durable layout without replacing the runtime', async () => {
    const { host, workspaceCapabilityTransitionHost, shutdown } = await buildRuntime()
    const created = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'primary')
    expect(created.ok).toBe(true)
    if (!created.ok) return
    setTestWorkspacePaneLayout({
      entries: [
        {
          target: { kind: 'git-worktree', root: LINKED_REPO_ROOT },
          tabs: [workspacePaneStaticTabEntry('files')],
        },
      ],
    })

    await expect(
      workspaceCapabilityTransitionHost.commitGitCapabilityRemoval({
        runtimeCapability: workspaceRuntimeCapability(),
      }),
    ).resolves.toEqual({ kind: 'committed' })

    await expect(
      host.listSessions('client_a', USER_1, { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }),
    ).resolves.toEqual([])
    expect(testWorkspacePaneLayout).toEqual({ entries: [] })
    shutdown()
  })

  test('Git capability cleanup preserves runtime resources when durable layout commit fails', async () => {
    const { host, workspaceCapabilityTransitionHost, shutdown } = await buildRuntime()
    const created = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'primary')
    expect(created.ok).toBe(true)
    setTestWorkspacePaneLayout({
      entries: [
        {
          target: { kind: 'git-worktree', root: LINKED_REPO_ROOT },
          tabs: [workspacePaneStaticTabEntry('files')],
        },
      ],
    })
    setTestWorkspacePaneLayoutWriteError(new Error('layout write failed'))

    const result = await workspaceCapabilityTransitionHost.commitGitCapabilityRemoval({
      runtimeCapability: workspaceRuntimeCapability(),
    })

    expect(result).toEqual({ kind: 'failed-before-commit', error: testWorkspacePaneLayoutWriteError })

    await expect(
      host.listSessions('client_a', USER_1, { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }),
    ).resolves.toHaveLength(1)
    expect(testWorkspacePaneLayout.entries).toHaveLength(1)
    shutdown()
  })

  test('capability cleanup rechecks currentness at its durable commit point', async () => {
    const { workspaceCapabilityTransitionHost, shutdown } = await buildRuntime()
    setTestWorkspacePaneLayout({
      entries: [
        {
          target: { kind: 'git-worktree', root: LINKED_REPO_ROOT },
          tabs: [workspacePaneStaticTabEntry('files')],
        },
      ],
    })
    let checks = 0
    await expect(
      workspaceCapabilityTransitionHost.commitGitCapabilityRemoval({
        runtimeCapability: workspaceRuntimeCapability(() => {
          checks += 1
          if (checks > 1) throw new Error('error.workspace-runtime-stale')
        }),
      }),
    ).resolves.toEqual({ kind: 'failed-before-commit', error: expect.any(Error) })

    expect(checks).toBe(2)
    expect(testWorkspacePaneLayout.entries).toHaveLength(1)
    shutdown()
  })

  test('Git capability removal commit is idempotent', async () => {
    const { host, workspaceCapabilityTransitionHost, shutdown } = await buildRuntime()
    const created = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'primary')
    expect(created.ok).toBe(true)
    setTestWorkspacePaneLayout({
      entries: [
        {
          target: { kind: 'git-worktree', root: LINKED_REPO_ROOT },
          tabs: [workspacePaneStaticTabEntry('files')],
        },
      ],
    })
    const input = {
      runtimeCapability: workspaceRuntimeCapability(),
    }

    await expect(workspaceCapabilityTransitionHost.commitGitCapabilityRemoval(input)).resolves.toEqual({
      kind: 'committed',
    })
    await expect(workspaceCapabilityTransitionHost.commitGitCapabilityRemoval(input)).resolves.toEqual({
      kind: 'committed',
    })

    await expect(
      host.listSessions('client_a', USER_1, { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }),
    ).resolves.toEqual([])
    expect(testWorkspacePaneLayout).toEqual({ entries: [] })
    shutdown()
  })

  test('does not schedule deferred capability effects after runtime shutdown', async () => {
    const { workspaceCapabilityTransitionHost, shutdown } = await buildRuntime()
    const pending = workspaceCapabilityTransitionHost.commitGitCapabilityRemoval({
      runtimeCapability: workspaceRuntimeCapability(),
    })

    shutdown()
    await expect(pending).resolves.toEqual({ kind: 'committed' })
    await Promise.resolve()
  })
})
