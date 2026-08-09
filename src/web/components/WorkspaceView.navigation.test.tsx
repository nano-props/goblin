// @vitest-environment jsdom

import {
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  setWorkspaceProbeForTest,
  createRepoBranch,
} from '#/web/test-utils/repo-store.ts'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { describe, expect, test, vi } from 'vitest'
import '#/web/test-utils/workspace-view.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { WorkspaceView } from '#/web/components/WorkspaceView.tsx'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import * as repoDataQuery from '#/web/repo-query-runtime.ts'
import {
  restoreWorkspaceTabsMocks,
  workspacePaneMocks,
  REPO_ID,
  filesystemWorkspaceProbe,
  branchWorkspaceView,
  render,
  branchNavigator,
  buttonByTestId,
  workspacePane,
} from '#/web/test-utils/workspace-view.tsx'

describe('WorkspaceView workspace navigation and restore', () => {
  test('keeps workspace pane scroll memory across a dashboard round trip', async () => {
    workspacePaneMocks.scrollMemoryProbe = true
    const result = render(branchWorkspaceView())

    buttonByTestId(result.container, 'workspace-pane-scroll-memory-write')?.click()
    await flushTestUpdates(async () => {
      await result.rerender(
        <WorkspaceView workspaceId={REPO_ID} routeView={{ kind: 'dashboard', workspaceId: REPO_ID }} />,
      )
    })
    await flushTestUpdates(async () => {
      await result.rerender(branchWorkspaceView())
    })

    expect(result.container.querySelector('[data-testid="workspace-pane-scroll-memory-value"]')?.textContent).toBe(
      '180',
    )
  })

  test('invalidates the Git projection and worktree status once when leaving a terminal for a static pane', async () => {
    const invalidateSnapshot = vi.spyOn(repoDataQuery, 'invalidateRepoMetadataQueries')
    const invalidateStatus = vi.spyOn(repoDataQuery, 'invalidateRepoWorktreeStatusQueries')
    const terminalRoute = {
      kind: 'branch' as const,
      workspaceId: REPO_ID,
      branchName: 'feature/a',
      workspacePaneRoute: { kind: 'terminal' as const, terminalSessionId: 'term-test-1' },
    }
    const result = render(<WorkspaceView workspaceId={REPO_ID} routeView={terminalRoute} />)

    await flushTestUpdates(async () => {
      await result.rerender(
        <WorkspaceView
          workspaceId={REPO_ID}
          routeView={{
            kind: 'branch',
            workspaceId: REPO_ID,
            branchName: 'feature/a',
            workspacePaneRoute: { kind: 'static', tab: 'status' },
          }}
        />,
      )
    })

    expect(invalidateSnapshot).toHaveBeenCalledTimes(1)
    expect(invalidateSnapshot).toHaveBeenCalledWith(REPO_ID, expect.any(String))
    expect(invalidateStatus).toHaveBeenCalledTimes(1)
    expect(invalidateStatus).toHaveBeenCalledWith(REPO_ID, expect.any(String))
  })

  test('does not invalidate Git reads for terminal-to-terminal or static-to-static navigation', async () => {
    const invalidateSnapshot = vi.spyOn(repoDataQuery, 'invalidateRepoMetadataQueries')
    const invalidateStatus = vi.spyOn(repoDataQuery, 'invalidateRepoWorktreeStatusQueries')
    const terminalRoute = {
      kind: 'branch' as const,
      workspaceId: REPO_ID,
      branchName: 'feature/a',
      workspacePaneRoute: { kind: 'terminal' as const, terminalSessionId: 'term-test-1' },
    }
    const result = render(<WorkspaceView workspaceId={REPO_ID} routeView={terminalRoute} />)

    await flushTestUpdates(async () => {
      await result.rerender(
        <WorkspaceView
          workspaceId={REPO_ID}
          routeView={{
            kind: 'branch',
            workspaceId: REPO_ID,
            branchName: 'feature/a',
            workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-test-2' },
          }}
        />,
      )
    })

    expect(invalidateSnapshot).not.toHaveBeenCalled()
    expect(invalidateStatus).not.toHaveBeenCalled()

    await flushTestUpdates(async () => {
      await result.rerender(
        <WorkspaceView workspaceId={REPO_ID} routeView={{ kind: 'dashboard', workspaceId: REPO_ID }} />,
      )
    })

    expect(invalidateSnapshot).toHaveBeenCalledTimes(1)
    expect(invalidateStatus).toHaveBeenCalledTimes(1)

    await flushTestUpdates(async () => {
      await result.rerender(branchWorkspaceView())
    })

    expect(invalidateSnapshot).toHaveBeenCalledTimes(1)
    expect(invalidateStatus).toHaveBeenCalledTimes(1)
  })

  test('projects a static workspace pane route change without remounting the workspace', async () => {
    const result = render(
      <WorkspaceView
        workspaceId={REPO_ID}
        routeView={{
          kind: 'branch',
          workspaceId: REPO_ID,
          branchName: 'feature/a',
          workspacePaneRoute: { kind: 'static', tab: 'history' },
        }}
      />,
    )

    expect(workspacePane(result.container)?.dataset.workspacePaneRouteTab).toBe('history')

    await flushTestUpdates(async () => {
      await result.rerender(
        <WorkspaceView
          workspaceId={REPO_ID}
          routeView={{
            kind: 'branch',
            workspaceId: REPO_ID,
            branchName: 'feature/a',
            workspacePaneRoute: { kind: 'static', tab: 'files' },
          }}
        />,
      )
    })

    expect(workspacePane(result.container)?.dataset.workspacePaneRouteTab).toBe('files')
  })

  test('does not transfer terminal-exit invalidations across workspaces', async () => {
    const otherWorkspaceId = workspaceIdForTest('goblin+file:///tmp/other-workspace')
    seedRepoWithReadModelForTest({
      id: otherWorkspaceId,
      branches: [createRepoBranch('main')],
      currentBranchName: null,
    })
    const invalidateSnapshot = vi.spyOn(repoDataQuery, 'invalidateRepoMetadataQueries')
    const invalidateStatus = vi.spyOn(repoDataQuery, 'invalidateRepoWorktreeStatusQueries')
    const result = render(
      <WorkspaceView
        workspaceId={REPO_ID}
        routeView={{
          kind: 'branch',
          workspaceId: REPO_ID,
          branchName: 'feature/a',
          workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-test-1' },
        }}
      />,
    )

    await flushTestUpdates(async () => {
      await result.rerender(
        <WorkspaceView
          workspaceId={otherWorkspaceId}
          routeView={{ kind: 'dashboard', workspaceId: otherWorkspaceId }}
        />,
      )
    })

    expect(invalidateSnapshot).not.toHaveBeenCalled()
    expect(invalidateStatus).not.toHaveBeenCalled()
  })

  test('does not invalidate Git reads when leaving a filesystem terminal', async () => {
    setWorkspaceProbeForTest(REPO_ID, filesystemWorkspaceProbe())
    const invalidateSnapshot = vi.spyOn(repoDataQuery, 'invalidateRepoMetadataQueries')
    const invalidateStatus = vi.spyOn(repoDataQuery, 'invalidateRepoWorktreeStatusQueries')
    const result = render(
      <WorkspaceView
        workspaceId={REPO_ID}
        routeView={{
          kind: 'workspace-root',
          workspaceId: REPO_ID,
          workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-test-1' },
        }}
      />,
    )

    await flushTestUpdates(async () => {
      await result.rerender(
        <WorkspaceView workspaceId={REPO_ID} routeView={{ kind: 'dashboard', workspaceId: REPO_ID }} />,
      )
    })

    expect(invalidateSnapshot).not.toHaveBeenCalled()
    expect(invalidateStatus).not.toHaveBeenCalled()
  })

  test('does not mount an existing repo before its runtime membership is restored', async () => {
    workspacesStore.setState({ workspaceMembershipReady: false })

    const { container } = render(
      <WorkspaceView workspaceId={REPO_ID} routeView={{ kind: 'dashboard', workspaceId: REPO_ID }} />,
    )

    expect(workspacePane(container)).toBeNull()
    expect(branchNavigator(container)).toBeNull()
    expect(container.querySelector('[data-testid="workspace-dashboard-page"]')).toBeNull()
  })

  test('renders a non-Git workspace in the shared shell without mounting Git-only actions', () => {
    setWorkspaceProbeForTest(REPO_ID, filesystemWorkspaceProbe())

    const { container } = render(
      <WorkspaceView
        workspaceId={REPO_ID}
        routeView={{ kind: 'workspace-root', workspaceId: REPO_ID, workspacePaneRoute: null }}
      />,
    )

    expect(workspacePane(container)?.dataset.currentBranchName).toBe('')
    expect(workspacePane(container)?.dataset.workspacePaneRouteKind).toBe('workspace-root')
    expect(branchNavigator(container)).toBeNull()
    expect(container.querySelector('[data-testid="dashboard-row-action"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workspace-root-row"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="create-worktree-row-action"]')).toBeNull()
    expect(container.querySelector('[data-testid="branch-filter-action"]')).toBeNull()
    expect(container.querySelector('[data-testid="repo-sync-action"]')).toBeNull()
    expect(restoreWorkspaceTabsMocks.useRestoreWorkspaceTabsOnView).not.toHaveBeenCalled()
    expect(restoreWorkspaceTabsMocks.useRepoToasts).not.toHaveBeenCalled()
  })

  test('renders the directory Dashboard for a non-Git dashboard route without Git navigation', () => {
    setWorkspaceProbeForTest(REPO_ID, filesystemWorkspaceProbe())

    const { container } = render(
      <WorkspaceView workspaceId={REPO_ID} routeView={{ kind: 'dashboard', workspaceId: REPO_ID }} />,
    )

    expect(container.querySelector('[data-testid="workspace-dashboard-page"]')).not.toBeNull()
    expect(workspacePane(container)).toBeNull()
    expect(branchNavigator(container)).toBeNull()
  })

  test('renders the shared directory Dashboard for a remote non-Git workspace', () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://example/srv/workspace')
    seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: {
        status: 'ready',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'unavailable' },
        },
        diagnostics: [],
      },
    })

    const { container } = render(
      <WorkspaceView workspaceId={workspaceId} routeView={{ kind: 'dashboard', workspaceId }} />,
    )

    expect(container.querySelector('[data-testid="workspace-dashboard-page"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workspace-root-row"]')).not.toBeNull()
    expect(branchNavigator(container)).toBeNull()
    expect(container.querySelector('[data-testid="repo-sync-action"]')).toBeNull()
  })

  test('keeps a routed repo on the restore skeleton until workspace membership is ready', () => {
    resetWorkspacesStore()

    const { container } = render(
      <WorkspaceView
        workspaceId={REPO_ID}
        routeView={{ kind: 'branch', workspaceId: REPO_ID, branchName: 'feature/a', workspacePaneRoute: null }}
      />,
    )

    expect(container.querySelector('[data-testid="workspace-pane-skeleton"]')).not.toBeNull()
    expect(container.textContent).not.toContain('workspace-route.not-found-title')
  })

  test('shows an explicit not-found state after membership restore settles without the routed repo', async () => {
    resetWorkspacesStore()
    workspacesStore.setState({ workspaceMembershipReady: true })

    const { container } = render(
      <WorkspaceView workspaceId={REPO_ID} routeView={{ kind: 'dashboard', workspaceId: REPO_ID }} />,
    )

    expect(container.textContent).toContain('workspace-route.not-found-title')
    expect(container.textContent).toContain('/tmp/repo-view-test')
    expect(container.textContent).not.toContain('goblin+file://')
  })

  test('moves a missing routed repo from restore skeleton to not-found when membership settles', async () => {
    resetWorkspacesStore()

    const result = render(
      <WorkspaceView workspaceId={REPO_ID} routeView={{ kind: 'dashboard', workspaceId: REPO_ID }} />,
    )

    expect(result.container.querySelector('[data-testid="empty-workspace-pane-skeleton"]')).not.toBeNull()
    expect(result.container.textContent).not.toContain('workspace-route.not-found-title')

    await flushTestUpdates(() => {
      workspacesStore.setState({ workspaceMembershipReady: true })
    })

    expect(result.container.querySelector('[data-testid="empty-workspace-pane-skeleton"]')).toBeNull()
    expect(result.container.textContent).toContain('workspace-route.not-found-title')
  })

  test('keeps a restore stub on the skeleton without mounting repo data surfaces', async () => {
    workspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [REPO_ID]: {
          ...state.workspaces[REPO_ID]!,
          session: { ...state.workspaces[REPO_ID]!.session, projectionState: 'stub' },
        },
      },
    }))

    const { container } = render(branchWorkspaceView())

    expect(container.querySelector('[data-testid="workspace-pane-skeleton"]')).not.toBeNull()
    expect(branchNavigator(container)).toBeNull()
    expect(workspacePane(container)).toBeNull()
    expect(restoreWorkspaceTabsMocks.useRestoreWorkspaceTabsOnView).toHaveBeenCalledWith({
      workspaceId: expect.any(Function),
    })
    const restoreOptions = restoreWorkspaceTabsMocks.useRestoreWorkspaceTabsOnView.mock.calls.at(-1)?.[0]
    expect(restoreOptions?.workspaceId()).toBe(REPO_ID)
  })

  test('replaces the stub skeleton with a stable promotion failure view', async () => {
    restoreWorkspaceTabsMocks.useRestoreWorkspaceTabsOnView.mockReturnValue({
      state: { value: { phase: 'failed', message: 'server request failed' } },
      retry: vi.fn(),
    })
    workspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [REPO_ID]: {
          ...state.workspaces[REPO_ID]!,
          session: { ...state.workspaces[REPO_ID]!.session, projectionState: 'stub' },
        },
      },
    }))

    const { container } = render(branchWorkspaceView())

    expect(container.querySelector('[data-testid="workspace-pane-skeleton"]')).toBeNull()
    expect(container.textContent).toContain('server request failed')
    expect(container.textContent).toContain('lazy-restore.failed')
  })
})
