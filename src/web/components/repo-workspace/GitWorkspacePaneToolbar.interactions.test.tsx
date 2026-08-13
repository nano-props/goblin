// @vitest-environment jsdom

import { flushTestUpdates } from '#/test-utils/render.tsx'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { terminalSessionBaseForTest } from '#/web/test-utils/terminal-model.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import type { ObservedBranchRouteNavigationForTest } from '#/web/test-utils/workspace-pane-navigation.ts'
import {
  REPO_ID,
  WORKTREE_PATH,
  flush,
  navigationWith,
  renderToolbar,
  staticEntry,
  tabsFor,
  terminalEntry,
  toastMocks,
  toolbarResponsiveMocks,
  workspaceRuntimeIdForTest,
} from '#/web/test-utils/git-workspace-pane-toolbar.tsx'

describe('GitWorkspacePaneToolbar interactions', () => {
  test('clicking the new-terminal button navigates and creates a terminal', async () => {
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
    })

    await flushTestUpdates(() => {
      terminalTab.click()
    })
    await flush()
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(mocks.createTerminal).toHaveBeenCalledTimes(1)
  })

  test('clicking the new-terminal button keeps a reused terminal id in its existing tab position', async () => {
    const { terminalTab } = renderToolbar({
      terminalCount: 0,
      workspacePaneTabs: [terminalEntry('term-111111111111111111111'), staticEntry('status')],
      navigation: navigationWith({}),
    })

    await flushTestUpdates(() => {
      terminalTab.click()
    })
    await flush()

    expect(tabsFor('feature/worktree')).toEqual([terminalEntry('term-111111111111111111111'), staticEntry('status')])
  })

  test('shows an error toast when new terminal creation fails', async () => {
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
    })
    mocks.createTerminal.mockRejectedValueOnce(new Error('error.terminal-create-failed'))

    await flushTestUpdates(() => {
      terminalTab.click()
    })
    await flush()

    expect(toastMocks.error).toHaveBeenCalledWith('action.result-error', {
      description: 'error.terminal-create-failed',
    })
  })

  test('clicking a selected session tab when not in terminal panel navigates to terminal', async () => {
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const commitFilesystemWorkspacePaneRoute = acceptedFilesystemCommit()
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 2,
      navigation: navigationWith({
        showRepoBranchWorkspacePaneTab,
        commitFilesystemWorkspacePaneRoute,
      }),
    })

    await flushTestUpdates(() => {
      terminalTab.click()
    })
    await flush()

    expectWorktreeRouteCommit(commitFilesystemWorkspacePaneRoute, {
      kind: 'terminal',
      terminalSessionId: 'term-111111111111111111111',
    })
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(mocks.createTerminal).not.toHaveBeenCalled()
    expect(mocks.selectTerminal).not.toHaveBeenCalled()
  })

  test('clicking a selected session tab in terminal panel scrolls to bottom', async () => {
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 2,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
    })

    await flushTestUpdates(() => {
      terminalTab.click()
    })
    await flush()
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(mocks.createTerminal).not.toHaveBeenCalled()
    expect(mocks.selectTerminal).not.toHaveBeenCalled()
    expect(mocks.scrollToBottom).toHaveBeenCalledWith('term-111111111111111111111')
  })

  test('clicking an unselected session tab navigates and selects it', async () => {
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const commitFilesystemWorkspacePaneRoute = acceptedFilesystemCommit()
    const { container: c, mocks } = renderToolbar({
      terminalCount: 2,
      navigation: navigationWith({
        showRepoBranchWorkspacePaneTab,
        commitFilesystemWorkspacePaneRoute,
      }),
    })

    const unselectedTab = c.querySelector<HTMLButtonElement>(
      '[data-workspace-pane-tab-tooltip-id="terminal:term-222222222222222222222"] button[role="tab"]',
    )
    expect(unselectedTab).not.toBeNull()

    await flushTestUpdates(() => {
      unselectedTab?.click()
    })
    await flush()

    expectWorktreeRouteCommit(commitFilesystemWorkspacePaneRoute, {
      kind: 'terminal',
      terminalSessionId: 'term-222222222222222222222',
    })
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(mocks.createTerminal).not.toHaveBeenCalled()
    expect(mocks.selectTerminal).not.toHaveBeenCalled()
  })

  test('selects a tab against the current worktree target after its path changes', async () => {
    const nextWorktreePath = '/tmp/goblin-repo-workspace-toolbar-worktree-relocated'
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const commitFilesystemWorkspacePaneRoute = acceptedFilesystemCommit()
    const { container: c, rerenderWorktreePath } = renderToolbar({
      terminalCount: 0,
      workspacePaneStaticTabs: ['status', 'files'],
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab, commitFilesystemWorkspacePaneRoute }),
    })

    await rerenderWorktreePath(nextWorktreePath)
    const filesTab = c.querySelector<HTMLButtonElement>(
      '[data-workspace-pane-tab-tooltip-id="workspace-pane:files"] button[role="tab"]',
    )
    expect(filesTab).not.toBeNull()

    await flushTestUpdates(() => filesTab?.click())
    await flush()

    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        routeTarget: { kind: 'git-worktree', workspaceId: REPO_ID, worktreePath: nextWorktreePath },
      }),
      { kind: 'static', tab: 'files' },
      expect.any(Object),
    )
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('does not show branch actions in the workspace bar (actions moved to branch rows)', () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
    })

    expect(c.querySelector('button[aria-label="action.menu"]')).toBeNull()
    expect(c.querySelector('[data-testid="repo-workspace-toolbar-divider"]')).toBeNull()
  })

  test('keeps terminal focus when pressing End on the compact terminal tab', async () => {
    const user = userEvent.setup()
    toolbarResponsiveMocks.compactUi = true
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const { container: c } = renderToolbar({
      terminalCount: 2,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
    })

    const terminalTab = c.querySelector<HTMLButtonElement>('#workspace-workspace-pane-tab')
    if (!terminalTab) throw new Error('missing compact terminal tab')

    terminalTab.focus()
    await user.keyboard('{End}')
    await flush()

    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(document.activeElement?.id).toBe('workspace-workspace-pane-tab')
  })

  test('moves focus across opened status, changes, and terminal tabs with keyboard navigation', async () => {
    const user = userEvent.setup()
    const showRepoBranchWorkspacePaneTab = vi.fn<
      ObservedBranchRouteNavigationForTest['showRepoBranchWorkspacePaneTab']
    >(() => true)
    const commitFilesystemWorkspacePaneRoute = acceptedFilesystemCommit()
    const { container: c } = renderToolbar({
      terminalCount: 2,
      changeCount: 1,
      workspacePaneStaticTabs: ['status', 'changes'],
      navigation: navigationWith({
        showRepoBranchWorkspacePaneTab,
        commitFilesystemWorkspacePaneRoute,
      }),
    })

    const statusTab = c.querySelector<HTMLButtonElement>('#workspace-status-tab')
    const changesTab = c.querySelector<HTMLButtonElement>('#workspace-changes-tab')
    const terminalTab = c.querySelector<HTMLButtonElement>('#workspace-workspace-pane-tab')
    if (!statusTab || !changesTab || !terminalTab) throw new Error('missing repo workspace pane tabs')

    statusTab.focus()
    await user.keyboard('{ArrowRight}')
    await flush()
    expectWorktreeRouteCommit(commitFilesystemWorkspacePaneRoute, { kind: 'static', tab: 'changes' })
    expect(document.activeElement).toBe(changesTab)
    commitFilesystemWorkspacePaneRoute.mockClear()

    await user.keyboard('{ArrowRight}')
    await flush()
    expectWorktreeRouteCommit(commitFilesystemWorkspacePaneRoute, {
      kind: 'terminal',
      terminalSessionId: 'term-111111111111111111111',
    })
    expect(document.activeElement).toBe(terminalTab)
    commitFilesystemWorkspacePaneRoute.mockClear()

    await user.keyboard('{ArrowLeft}')
    await flush()
    expectWorktreeRouteCommit(commitFilesystemWorkspacePaneRoute, { kind: 'static', tab: 'changes' })
    expect(document.activeElement).toBe(changesTab)
  })

  test('skips the changes tab in keyboard navigation when it is not open', async () => {
    const user = userEvent.setup()
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const commitFilesystemWorkspacePaneRoute = acceptedFilesystemCommit()
    const { container: c } = renderToolbar({
      terminalCount: 2,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({
        showRepoBranchWorkspacePaneTab,
        commitFilesystemWorkspacePaneRoute,
      }),
    })

    expect(c.querySelector('[data-workspace-pane-tab-tooltip-id="workspace-pane:changes"]')).toBeNull()
    const statusTab = c.querySelector<HTMLButtonElement>('#workspace-status-tab')
    const terminalTab = c.querySelector<HTMLButtonElement>('#workspace-workspace-pane-tab')
    if (!statusTab || !terminalTab) throw new Error('missing repo workspace pane tabs')

    terminalTab.focus()
    await user.keyboard('{ArrowLeft}')
    await flush()
    expectWorktreeRouteCommit(commitFilesystemWorkspacePaneRoute, { kind: 'static', tab: 'status' })
    expect(document.activeElement).toBe(statusTab)
  })

  test('lands on the spatial neighbor after closing the active terminal tab', async () => {
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const commitFilesystemWorkspacePaneRoute = acceptedFilesystemCommit()
    const { container: c, mocks } = renderToolbar({
      terminalCount: 1,
      workspacePaneTabs: [staticEntry('status'), terminalEntry('term-111111111111111111111'), staticEntry('changes')],
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab, commitFilesystemWorkspacePaneRoute }),
    })

    const terminalCloseButton = c.querySelector<HTMLElement>(
      '[data-toolbar-tab-close-action][title^="terminal.close-named"]',
    )
    expect(terminalCloseButton).not.toBeNull()

    await flushTestUpdates(() => {
      terminalCloseButton?.click()
    })
    await flush()

    expect(mocks.closeTerminalByDescriptor).toHaveBeenCalledWith(
      'term-111111111111111111111',
      terminalSessionBaseForTest({
        repoRoot: REPO_ID,
        workspaceRuntimeId: workspaceRuntimeIdForTest(),
        branch: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
      }),
    )
    expectWorktreeRouteCommit(commitFilesystemWorkspacePaneRoute, { kind: 'static', tab: 'changes' })
  })

  test('opens a terminal while the initial session projection is still in flight', async () => {
    const { container: c, mocks } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
      loading: true,
    })

    expect(c.querySelector('#workspace-status-tab')).not.toBeNull()
    const newButton = c.querySelector<HTMLButtonElement>('[data-workspace-pane-new-button]')
    expect(newButton).not.toBeNull()
    expect(newButton?.getAttribute('aria-label')).toBe('terminal.new')
    expect(newButton?.getAttribute('aria-busy')).toBeNull()
    expect(newButton?.disabled).toBe(false)

    await flushTestUpdates(() => {
      newButton?.click()
    })
    await flush()
    expect(mocks.createTerminal).toHaveBeenCalledOnce()
  })

  test('opens a terminal for the current runtime when only a stale runtime projection is hydrated', async () => {
    terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, 'repo-runtime-old')
    const { container: c, mocks } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
      loading: true,
      workspaceRuntimeId: 'repo-runtime-new',
    })

    const newButton = c.querySelector<HTMLButtonElement>('[data-workspace-pane-new-button]')
    expect(newButton).not.toBeNull()
    expect(newButton?.getAttribute('aria-busy')).toBeNull()
    expect(newButton?.disabled).toBe(false)

    await flushTestUpdates(() => {
      newButton?.click()
    })
    await flush()
    expect(mocks.createTerminal).toHaveBeenCalledOnce()
  })

  test('does not create another terminal while terminal creation is already pending', async () => {
    const { container: c, mocks } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
      createPending: true,
    })

    expect(c.querySelector('[data-workspace-pane-skeleton-chip=""]')).toBeNull()
    const busyNewButton = c.querySelector<HTMLButtonElement>('[data-workspace-pane-new-button]')
    expect(busyNewButton).not.toBeNull()
    expect(busyNewButton?.getAttribute('aria-label')).toBe('terminal.new')
    expect(busyNewButton?.getAttribute('aria-busy')).toBe('true')
    expect(busyNewButton?.disabled).toBe(true)
    expect(busyNewButton?.querySelector('.animate-spin')).toBeNull()

    await flushTestUpdates(() => {
      busyNewButton?.click()
    })
    await flush()
    expect(mocks.createTerminal).not.toHaveBeenCalled()
  })

  test('does not create another terminal during pending creation when a terminal is already open', async () => {
    const { container: c, mocks } = renderToolbar({
      terminalCount: 1,
      navigation: navigationWith({}),
      createPending: true,
    })

    expect(c.querySelector('[data-workspace-pane-tab-tooltip-id="terminal:term-111111111111111111111"]')).not.toBeNull()
    const busyNewButton = c.querySelector<HTMLButtonElement>('[data-workspace-pane-new-button]')
    expect(busyNewButton).not.toBeNull()
    expect(busyNewButton?.getAttribute('aria-label')).toBe('terminal.new')
    expect(busyNewButton?.getAttribute('aria-busy')).toBe('true')
    expect(busyNewButton?.disabled).toBe(true)
    expect(busyNewButton?.querySelector('.animate-spin')).toBeNull()

    await flushTestUpdates(() => {
      busyNewButton?.click()
    })
    await flush()
    expect(mocks.createTerminal).not.toHaveBeenCalled()
  })
})

function acceptedFilesystemCommit() {
  return vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>(async (_target, _route, options) => {
    options?.onCommit?.()
    return true
  })
}

function expectWorktreeRouteCommit(
  commit: ReturnType<typeof acceptedFilesystemCommit>,
  route: Parameters<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>[1],
): void {
  expect(commit).toHaveBeenCalledWith(
    expect.objectContaining({
      routeTarget: { kind: 'git-worktree', workspaceId: REPO_ID, worktreePath: WORKTREE_PATH },
    }),
    route,
    expect.any(Object),
  )
}
