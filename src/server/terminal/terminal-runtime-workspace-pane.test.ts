import { describe, expect, test, vi } from 'vitest'
import {
  acquireWorkspaceRuntime,
  closeWorkspaceRuntimesForDurableRemoval,
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

describe('server terminal runtime workspace panes', () => {
  test('realtime workspace pane tabs replace materializes missing terminal tabs and list returns canonical tabs', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socket)
    const created = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'additional')
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket,
        WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace,
        {
          ...workspacePaneTabsListInput(WORKSPACE_RUNTIME_ID),
          target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
          tabs: [{ type: 'status', tabId: 'workspace-pane:status' }],
        },
        'req_replace_workspace_tabs',
      ),
    ).resolves.toMatchObject({
      entries: [
        {
          tabs: [
            { type: 'status', tabId: 'workspace-pane:status' },
            { type: 'terminal', runtimeSessionId: created.terminalSessionId },
          ],
        },
      ],
    })
    await vi.waitFor(() => {
      expect(
        sentSocketMessages(socket).some((message) => message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed),
      ).toBe(true)
    })
    socket.send.mockClear()

    host.handleRealtimeMessage(
      'client_a',
      USER_1,
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_list_workspace_tabs',
        action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
        input: workspacePaneTabsListInput(WORKSPACE_RUNTIME_ID),
      }),
    )

    await vi.waitFor(() => {
      const messages = sentSocketMessages(socket)
      expect(
        messages.some((message) => message.type === 'response' && message.requestId === 'req_list_workspace_tabs'),
      ).toBe(true)
    })
    const response = sentSocketMessages(socket).find(
      (message) => message.type === 'response' && message.requestId === 'req_list_workspace_tabs',
    )
    expect(response).toMatchObject({
      type: 'response',
      ok: true,
      action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
      payload: {
        revision: expect.any(Number),
        entries: [
          {
            target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
            tabs: [
              { type: 'status', tabId: 'workspace-pane:status' },
              { type: 'terminal', runtimeSessionId: created.terminalSessionId },
            ],
          },
        ],
      },
    })

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('broadcasts an accepted durable pane layout change to every active user projection', async () => {
    const { host, shutdown } = buildRuntime()
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
    const { host, shutdown } = buildRuntime()
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
    const { host, shutdown } = buildRuntime()
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
    const { host, shutdown } = buildRuntime()
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
      entries: [
        {
          tabs: [
            { type: 'status', tabId: 'workspace-pane:status' },
            { type: 'terminal', runtimeSessionId: first.terminalSessionId },
            { type: 'history', tabId: 'workspace-pane:history' },
          ],
        },
      ],
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
    commitTerminalReadyProbe(USER_1, REPO_ROOT, nextWorkspaceRuntimeId)

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
    const { host, workspaceCapabilityTransitionHost, shutdown } = buildRuntime()
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
        userId: USER_1,
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        assertCurrent: () => {},
      }),
    ).resolves.toEqual({ kind: 'committed' })

    await expect(
      host.listSessions('client_a', USER_1, { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }),
    ).resolves.toEqual([])
    expect(testWorkspacePaneLayout).toEqual({ entries: [] })
    shutdown()
  })

  test('Git capability cleanup preserves runtime resources when durable layout commit fails', async () => {
    const { host, workspaceCapabilityTransitionHost, shutdown } = buildRuntime()
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
      userId: USER_1,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      assertCurrent: () => {},
    })

    expect(result).toEqual({ kind: 'failed-before-commit', error: testWorkspacePaneLayoutWriteError })

    await expect(
      host.listSessions('client_a', USER_1, { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }),
    ).resolves.toHaveLength(1)
    expect(testWorkspacePaneLayout.entries).toHaveLength(1)
    shutdown()
  })

  test('capability cleanup fast-fails once before its durable transaction', async () => {
    const { workspaceCapabilityTransitionHost, shutdown } = buildRuntime()
    setTestWorkspacePaneLayout({
      entries: [
        {
          target: { kind: 'git-worktree', root: LINKED_REPO_ROOT },
          tabs: [workspacePaneStaticTabEntry('files')],
        },
      ],
    })
    let checks = 0
    await workspaceCapabilityTransitionHost.commitGitCapabilityRemoval({
      userId: USER_1,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      assertCurrent: () => {
        checks += 1
        if (checks > 1) throw new Error('error.workspace-runtime-stale')
      },
    })

    expect(checks).toBe(1)
    expect(testWorkspacePaneLayout).toEqual({ entries: [] })
    shutdown()
  })

  test('Git capability removal commit is idempotent', async () => {
    const { host, workspaceCapabilityTransitionHost, shutdown } = buildRuntime()
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
      userId: USER_1,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      assertCurrent: () => {},
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
    const { workspaceCapabilityTransitionHost, shutdown } = buildRuntime()
    const pending = workspaceCapabilityTransitionHost.commitGitCapabilityRemoval({
      userId: USER_1,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      assertCurrent: () => {},
    })

    shutdown()
    await expect(pending).resolves.toEqual({ kind: 'committed' })
    await Promise.resolve()
  })
})
