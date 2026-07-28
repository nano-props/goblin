// @vitest-environment jsdom

import { seedRepoWithReadModelForTest, createBranchSnapshot } from '#/web/test-utils/repo-store.ts'
import { act, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, test } from 'vitest'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import {
  workspaceRootPaneFilesystemTarget,
  gitWorktreePaneFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import {
  REPO_ID,
  WORKTREE_PATH,
  WorkspaceOpenExternallyMenu,
  defaultRuntimeExternalAppSettings,
  externalAppTargetKey,
  externalMenuTarget,
  flush,
  gitWorkspacePaneProjection,
  installRecentAppFetch,
  navigationWith,
  openPopover,
  renderInJsdom,
  renderToolbar,
  runtimeExternalAppSettings,
  seededQueryClientWithWorkspaceSettings,
  toastMocks,
  toolbarResponsiveMocks,
  workspaceExternalAppMocks,
} from '#/web/test-utils/git-workspace-pane-toolbar.tsx'

describe('GitWorkspacePaneToolbar external-apps', () => {
  test('renders the external app launcher at the workspace toolbar right edge', () => {
    runtimeExternalAppSettings.value = {
      ...defaultRuntimeExternalAppSettings(),
      editorAppAvailability: { vscode: true },
    }
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
    })

    const trigger = c.querySelector<HTMLButtonElement>('[data-testid="workspace-open-externally-menu-trigger"]')
    if (!trigger) throw new Error('missing external app menu trigger')
    const trailingActions = c.querySelector('[data-workspace-toolbar-trailing-actions]')
    expect(trailingActions).not.toBeNull()
    expect(trailingActions?.contains(trigger)).toBe(true)

    openPopover(trigger)

    const menuItems = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="listitem"] button')).map(
      (button) => button.textContent,
    )
    expect(menuItems).toEqual([
      'settings.terminal.ghostty',
      'settings.terminal.terminal',
      'settings.editor.vscode',
      'worktrees.reveal-title',
    ])
  })

  test('opens a workspace root through the shared external app launcher', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-external-app-workspace')
    const target = workspaceRootPaneFilesystemTarget({
      workspaceId,
      workspaceRuntimeId: 'workspace-runtime-external-app',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
    })
    const { container } = renderInJsdom(
      <QueryClientProvider client={seededQueryClientWithWorkspaceSettings([])}>
        <WorkspaceOpenExternallyMenu target={target} />
      </QueryClientProvider>,
    )

    const primary = container.querySelector<HTMLButtonElement>('[data-testid="workspace-open-externally-menu-primary"]')
    if (!primary) throw new Error('missing external app primary action')
    act(() => {
      primary.click()
    })

    await waitFor(() =>
      expect(workspaceExternalAppMocks.openWorkspaceTerminal).toHaveBeenCalledWith(
        {
          kind: 'workspace-root',
          workspaceId,
          workspaceRuntimeId: 'workspace-runtime-external-app',
        },
        'ghostty',
      ),
    )
  })

  test('opens a detached worktree through its filesystem execution target', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/worktree', {
          worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
        }),
      ],
    })
    const projection = gitWorkspacePaneProjection(repo)
    if (projection.probe.status !== 'ready') throw new Error('expected ready Git workspace fixture')
    const target = gitWorktreePaneFilesystemTarget({
      workspaceId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      worktreePath: WORKTREE_PATH,
      head: { kind: 'detached' },
      capabilities: projection.probe.capabilities,
    })
    const { container } = renderInJsdom(
      <QueryClientProvider client={seededQueryClientWithWorkspaceSettings([])}>
        <WorkspaceOpenExternallyMenu target={target} />
      </QueryClientProvider>,
    )

    const primary = container.querySelector<HTMLButtonElement>('[data-testid="workspace-open-externally-menu-primary"]')
    if (!primary) throw new Error('missing external app primary action')
    act(() => {
      primary.click()
    })

    await waitFor(() =>
      expect(workspaceExternalAppMocks.openWorkspaceTerminal).toHaveBeenCalledWith(
        {
          kind: 'git-worktree',
          workspaceId: REPO_ID,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          root: canonicalWorkspaceLocator(`goblin+file://${WORKTREE_PATH}`),
        },
        'ghostty',
      ),
    )
  })

  test('does not render the external app launcher for a branch without a filesystem target', () => {
    const { container } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
      worktree: false,
    })

    expect(container.querySelector('[data-testid="workspace-open-externally-menu-primary"]')).toBeNull()
    expect(container.querySelector('[data-testid="workspace-open-externally-menu-trigger"]')).toBeNull()
    expect(container.querySelector('[data-workspace-toolbar-trailing-actions]')).toBeNull()
  })

  test('keeps remote-capable apps and hides Finder for a remote workspace root', () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://example.test/workspace')
    const target = workspaceRootPaneFilesystemTarget({
      workspaceId,
      workspaceRuntimeId: 'workspace-runtime-remote-external-app',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
    })
    const { container } = renderInJsdom(
      <QueryClientProvider client={seededQueryClientWithWorkspaceSettings([])}>
        <WorkspaceOpenExternallyMenu target={target} />
      </QueryClientProvider>,
    )

    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="workspace-open-externally-menu-trigger"]')
    if (!trigger) throw new Error('missing external app menu trigger')
    openPopover(trigger)

    const labels = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="listitem"] button')).map(
      (button) => button.textContent,
    )
    expect(labels).toEqual(['settings.terminal.ghostty', 'settings.terminal.terminal', 'settings.editor.vscode'])
    expect(labels).not.toContain('worktrees.reveal-title')
  })

  test('hides the open-externally menu when no local external apps are available', async () => {
    useHostInfoStore.setState({
      snapshot: { homeDir: '/Users/tester', platform: 'win32', hostname: 'test-host', pid: 1 },
      status: 'ready',
      error: null,
    })
    runtimeExternalAppSettings.value = {
      terminalAvailable: false,
      terminalAppAvailability: { ghostty: false, terminal: false, windowsTerminal: false },
      editorAvailable: false,
      editorAppAvailability: { vscode: false },
    }
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
      remote: { hasBrowserRemote: true, browserRemoteProvider: 'github' },
    })

    const primary = c.querySelector<HTMLButtonElement>('[data-testid="workspace-open-externally-menu-primary"]')
    const trigger = c.querySelector<HTMLButtonElement>('[data-testid="workspace-open-externally-menu-trigger"]')
    expect(primary).toBeNull()
    expect(trigger).toBeNull()
    expect(c.querySelector('[data-workspace-toolbar-trailing-actions]')).toBeNull()
  })

  test('uses the first visible external app as the split-button primary action without recent state', () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
    })

    expect(c.querySelector<HTMLButtonElement>('button[aria-label="settings.terminal.ghostty"]')).not.toBeNull()
    expect(c.querySelector<HTMLButtonElement>('button[aria-label="settings.editor.vscode"]')).toBeNull()
  })

  test('uses the scoped recent external app as the split-button primary action', async () => {
    const initialSnapshot = defaultSettingsSnapshot({ workspaceSettings: [] })
    const fetchSpy = installRecentAppFetch(initialSnapshot)
    const { container: c, queryClient } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
    })

    const trigger = c.querySelector<HTMLButtonElement>('[data-testid="workspace-open-externally-menu-trigger"]')
    if (!trigger) throw new Error('missing external app menu trigger')

    openPopover(trigger)

    const finderItem = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'worktrees.reveal-title',
    )
    expect(finderItem).not.toBeNull()

    await act(async () => {
      finderItem?.click()
      await flush()
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/settings/workspace-external-app-recent'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          workspaceId: REPO_ID,
          targetKey: externalAppTargetKey(WORKTREE_PATH),
          itemId: 'finder',
        }),
      }),
    )
    expect(workspaceExternalAppMocks.openWorkspaceInFinder).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'git-worktree',
        workspaceId: REPO_ID,
        root: canonicalWorkspaceLocator(`goblin+file://${WORKTREE_PATH}`),
      }),
    )

    // Simulate the server-driven settings-snapshot invalidation that
    // `publishSettingsInvalidation(['settings-snapshot'])` would push to
    // the client in production. The refetch then picks up the new recent
    // written by the mock.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: settingsSnapshotQueryKey(), exact: true })
      await flush()
    })

    const primary = c.querySelector<HTMLButtonElement>('button[aria-label="worktrees.reveal-title"]')
    expect(primary).not.toBeNull()

    await act(async () => {
      primary?.click()
      await flush()
    })

    // Clicking the same recent item is a no-op — the menu skips the
    // server write. Only the first click should have hit the POST
    // endpoint; the second click is purely a local open.
    const postCalls = fetchSpy.mock.calls.filter(([input]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      return url.endsWith('/api/settings/workspace-external-app-recent')
    })
    expect(postCalls).toHaveLength(1)
    expect(workspaceExternalAppMocks.openWorkspaceInFinder).toHaveBeenCalledTimes(2)
  })

  test('shows an error toast when storing the recent external app fails', async () => {
    const initialSnapshot = defaultSettingsSnapshot({ workspaceSettings: [] })
    installRecentAppFetch(initialSnapshot, { failPost: true })
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
    })

    const trigger = c.querySelector<HTMLButtonElement>('[data-testid="workspace-open-externally-menu-trigger"]')
    if (!trigger) throw new Error('missing external app menu trigger')

    openPopover(trigger)

    const finderItem = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'worktrees.reveal-title',
    )
    expect(finderItem).not.toBeNull()

    await act(async () => {
      finderItem?.click()
      await flush()
    })

    expect(toastMocks.error).toHaveBeenCalledWith('action.result-error', {
      description: 'Server request failed (HTTP 500)',
    })
    expect(workspaceExternalAppMocks.openWorkspaceInFinder).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'git-worktree',
        workspaceId: REPO_ID,
        root: canonicalWorkspaceLocator(`goblin+file://${WORKTREE_PATH}`),
      }),
    )
    expect(c.querySelector<HTMLButtonElement>('button[aria-label="settings.terminal.ghostty"]')).not.toBeNull()
  })

  test('reloads the scoped recent external app when the worktree path changes', async () => {
    const nextWorktreePath = '/tmp/goblin-repo-workspace-toolbar-worktree-next'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/worktree', {
          worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
        }),
      ],
    })
    const { container, rerender } = renderInJsdom(
      <QueryClientProvider
        client={seededQueryClientWithWorkspaceSettings([
          {
            workspaceId: REPO_ID,
            workspaceExternalAppRecent: {
              byTarget: {
                [externalAppTargetKey(WORKTREE_PATH)]: 'finder',
                [externalAppTargetKey(nextWorktreePath)]: 'editor:vscode',
              },
            },
          },
        ])}
      >
        <WorkspaceOpenExternallyMenu target={externalMenuTarget(repo, WORKTREE_PATH)} />
      </QueryClientProvider>,
    )

    expect(container.querySelector<HTMLButtonElement>('button[aria-label="worktrees.reveal-title"]')).not.toBeNull()

    rerender(
      <QueryClientProvider
        client={seededQueryClientWithWorkspaceSettings([
          {
            workspaceId: REPO_ID,
            workspaceExternalAppRecent: {
              byTarget: {
                [externalAppTargetKey(WORKTREE_PATH)]: 'finder',
                [externalAppTargetKey(nextWorktreePath)]: 'editor:vscode',
              },
            },
          },
        ])}
      >
        <WorkspaceOpenExternallyMenu target={externalMenuTarget(repo, nextWorktreePath)} />
      </QueryClientProvider>,
    )

    expect(container.querySelector<HTMLButtonElement>('button[aria-label="settings.editor.vscode"]')).not.toBeNull()
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="worktrees.reveal-title"]')).toBeNull()
  })

  test('keeps the external app launcher available in compact filesystem toolbars', () => {
    toolbarResponsiveMocks.compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 1,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
    })

    const trigger = c.querySelector<HTMLButtonElement>('button[aria-label="workspace.open-externally.open"]')
    expect(trigger).not.toBeNull()
    expect(c.querySelector('[data-workspace-toolbar-trailing-actions]')?.contains(trigger)).toBe(true)
  })
})
