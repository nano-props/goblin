// @vitest-environment jsdom

import { act } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoWorkspaceToolbar } from '#/web/components/repo-workspace/RepoWorkspaceToolbar.tsx'
import { WorkspaceOpenExternallyMenu } from '#/web/components/repo-workspace/WorkspaceOpenExternallyMenu.tsx'
import { getSelectedRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import { useRepoWorkspaceTabModel } from '#/web/components/repo-workspace/use-repo-workspace-tab-model.ts'
import { useBranchActions, type BranchActions } from '#/web/hooks/useBranchActions.tsx'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  WorkspacePaneStaticTabType,
  WorkspacePaneTabEntry,
  WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
  TerminalSessionSummary,
  TerminalDescriptor,
  TerminalWorktreeSnapshot,
} from '#/web/components/terminal/types.ts'
import {
  PrimaryWindowNavigationProvider,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import {
  createRepoBranch,
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
  seedRepoState,
} from '#/web/test-utils/bridge.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import { workspacePaneTabsTargetForRepoBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import {
  readWorkspacePaneTabsForTarget,
  setWorkspacePaneTabsForTargetQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneStaticTabsFromEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import type { RepoSettingsEntry } from '#/shared/repo-settings.ts'

let compactUi = false
const runtimeExternalAppSettings = vi.hoisted(() => ({
  value: {
    terminalAvailable: true,
    terminalAppAvailability: { ghostty: true, terminal: true, windowsTerminal: false },
    editorAvailable: true,
    editorAppAvailability: { vscode: true },
  },
}))
const appShellMocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
}))
const repoClientMocks = vi.hoisted(() => ({
  openRepoInFinder: vi.fn(async (path: string) => ({ ok: true, message: path })),
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => compactUi,
}))

vi.mock('#/web/runtime-settings-external-apps.ts', () => ({
  useExternalAppSettings: () => runtimeExternalAppSettings.value,
}))

vi.mock('#/web/app-shell-client.ts', () => ({
  openExternalUrl: appShellMocks.openExternalUrl,
}))

vi.mock('#/web/repo-client.ts', async () => {
  const actual = (await vi.importActual('#/web/repo-client.ts')) as typeof import('#/web/repo-client.ts')
  return {
    ...actual,
    openRepoInFinder: repoClientMocks.openRepoInFinder,
  }
})

vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => {
  cb(0)
  return 1
}) as typeof requestAnimationFrame)

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastMocks.error,
  },
}))

const REPO_ID = '/tmp/gbl-repo-workspace-toolbar-repo'
const WORKTREE_PATH = '/tmp/gbl-repo-workspace-toolbar-worktree'
compactUi = false

function defaultRuntimeExternalAppSettings() {
  return {
    terminalAvailable: true,
    terminalAppAvailability: { ghostty: true, terminal: true, windowsTerminal: false },
    editorAvailable: true,
    editorAppAvailability: { vscode: true },
  }
}

type RepoWorkspaceToolbarHarnessProps = Omit<
  ComponentProps<typeof RepoWorkspaceToolbar>,
  'workspacePaneTabModel' | 'branchActions'
>

function RepoWorkspaceToolbarHarness(props: RepoWorkspaceToolbarHarnessProps) {
  const workspacePaneTabModel = useRepoWorkspaceTabModel(props.repo, props.detail)
  const branchActions = useBranchActions(props.repo, props.detail.branch!)
  return <RepoWorkspaceToolbar {...props} workspacePaneTabModel={workspacePaneTabModel} branchActions={branchActions} />
}

beforeEach(() => {
  compactUi = false
  runtimeExternalAppSettings.value = defaultRuntimeExternalAppSettings()
  appShellMocks.openExternalUrl.mockReset()
  repoClientMocks.openRepoInFinder.mockReset()
  repoClientMocks.openRepoInFinder.mockImplementation(async (path: string) => ({ ok: true, message: path }))
  useHostInfoStore.setState({
    snapshot: { homeDir: '/Users/tester', platform: 'darwin', hostname: 'test-host', pid: 1 },
    hydrated: true,
  })
  resetReposStore()
  installWorkspacePaneTabsTestBridge()
  // T6.1: the toolbar reads `isInitialSyncInFlight` from
  // useRepoSyncStore; existing tests assume the repo has been
  // synced. Mark ready by default so the "+ New" button renders; the
  // loading-state test skips this and expects the same button to be busy.
  useRepoSyncStore.setState({ ready: new Map(), timestamps: new Map() })
})

afterEach(() => {
  toastMocks.error.mockClear()
  appShellMocks.openExternalUrl.mockReset()
  repoClientMocks.openRepoInFinder.mockReset()
  useHostInfoStore.setState({ snapshot: null, hydrated: false })
  setClientBridgeForTests(null)
  setTerminalSessionCommandBridge(null)
})

describe('RepoWorkspaceToolbar', () => {
  test('renders a status tab for a selected branch without a worktree', async () => {
    const showRepoWorkspacePaneTab = vi.fn()
    const { container: c, terminalTab } = renderToolbar({
      terminalCount: 0,
      worktree: false,
      navigation: navigationWith({ showRepoWorkspacePaneTab }),
    })

    const tabs = Array.from(c.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
    expect(tabs).toHaveLength(1)
    expect(tabs[0]?.id).toBe('workspace-status-tab')
    expect(tabs[0]?.textContent).toBe('tab.status')
    expect(tabs[0]?.getAttribute('aria-controls')).toBe('workspace-status-panel')
    expect(c.querySelector('#workspace-workspace-pane-tab-empty')).toBeNull()
    expect(c.querySelector('button[aria-label="terminal.new"]')).toBeNull()

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'status')
  })

  test('keeps the focus-offset leading spacer mounted for width transitions', () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      worktree: false,
      navigation: navigationWith({}),
      trafficLightOffset: true,
    })

    const toolbarClassName = c.querySelector('.goblin-workspace-toolbar')?.className ?? ''
    expect(toolbarClassName).toContain('goblin-workspace-toolbar--traffic-offset')
    expect(toolbarClassName).toContain('gap-0')
    expect(c.querySelector('[data-testid="workspace-toolbar-leading-spacer"]')?.className).toContain(
      'goblin-workspace-toolbar__leading-spacer--reserved',
    )
    expect(
      c.querySelector<HTMLElement>('[data-testid="workspace-toolbar-leading-no-drag"]')?.dataset.titleBarChromeRegion,
    ).toBe('no-drag')
  })

  test('keeps the leading spacer mounted when the focus offset is inactive', () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      worktree: false,
      navigation: navigationWith({}),
      trafficLightOffset: false,
    })

    const toolbarClassName = c.querySelector('.goblin-workspace-toolbar')?.className ?? ''
    expect(toolbarClassName).not.toContain('title-bar-chrome')
    expect(toolbarClassName).not.toContain('goblin-workspace-toolbar--non-draggable')
    expect(toolbarClassName).toContain('gap-0')
    expect(c.querySelector('[data-testid="workspace-toolbar-leading-spacer"]')).not.toBeNull()
    expect(c.querySelector('[data-testid="workspace-toolbar-leading-spacer"]')?.className).not.toContain(
      'goblin-workspace-toolbar__leading-spacer--reserved',
    )
    expect(c.querySelector('[data-testid="workspace-toolbar-leading-no-drag"]')).toBeNull()
  })

  test('does not opt compact toolbar chrome into window dragging', () => {
    compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 0,
      worktree: false,
      navigation: navigationWith({}),
    })

    expect(c.querySelector('.goblin-workspace-toolbar')?.className).not.toContain('app-drag-region')
    expect(c.querySelector('.goblin-workspace-toolbar')?.className).not.toContain('title-bar-chrome')
    expect(c.querySelector('.goblin-workspace-toolbar')?.className).toContain('goblin-workspace-toolbar--non-draggable')
  })

  test('renders status and terminal affordance without a default changes tab', () => {
    const { container: c } = renderToolbar({ terminalCount: 0, changeCount: 3, navigation: navigationWith({}) })

    const tabs = Array.from(c.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
    expect(tabs.map((tab) => tab.id)).toEqual(['workspace-status-tab'])
    // The empty state is a plus icon button — no text label, just an aria-label/tooltip
    // describing the action. `useT` is mocked to return the key string, so checking that
    // textContent does not contain "terminal.label" guards against regressing back to
    // the old text-only button that rendered `t('terminal.label')` as its label.
    const emptyButton = c.querySelector<HTMLButtonElement>('button[aria-label="terminal.new"]')
    expect(emptyButton).not.toBeNull()
    expect(emptyButton?.textContent ?? '').not.toContain('terminal.label')
    expect(emptyButton?.getAttribute('aria-label')).toBe('terminal.new')
    expect(emptyButton?.getAttribute('title')).toBe('terminal.new')
    expect(c.querySelector('[data-workspace-pane-tab-tooltip-id="workspace-pane:status"]')).not.toBeNull()
    expect(c.querySelector('[data-workspace-pane-tab-tooltip-id="workspace-pane:changes"]')).toBeNull()
  })

  test('renders the external app launcher at the workspace toolbar right edge', async () => {
    runtimeExternalAppSettings.value = {
      ...defaultRuntimeExternalAppSettings(),
      editorAppAvailability: { vscode: true },
    }
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
    })

    const trigger = c.querySelector<HTMLButtonElement>('[data-testid="workspace-open-externally-menu-trigger"]')
    expect(trigger).not.toBeNull()
    const trailingActions = c.querySelector('[data-workspace-toolbar-trailing-actions]')
    expect(trailingActions).not.toBeNull()
    expect(trailingActions?.contains(trigger)).toBe(true)

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

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

  test('hides the open-externally menu when no local external apps are available', async () => {
    useHostInfoStore.setState({
      snapshot: { homeDir: '/Users/tester', platform: 'win32', hostname: 'test-host', pid: 1 },
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
    const initialSnapshot = defaultSettingsSnapshot({ repoSettings: [] })
    const fetchSpy = mockRecentAppPostFetch(initialSnapshot)
    const { container: c, queryClient } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
    })

    const trigger = c.querySelector<HTMLButtonElement>('[data-testid="workspace-open-externally-menu-trigger"]')
    expect(trigger).not.toBeNull()

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    const finderItem = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'worktrees.reveal-title',
    )
    expect(finderItem).not.toBeNull()

    await act(async () => {
      finderItem?.click()
      await flush()
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/settings/repo-external-app-recent'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ repoId: REPO_ID, worktreePath: WORKTREE_PATH, itemId: 'finder' }),
      }),
    )
    expect(repoClientMocks.openRepoInFinder).toHaveBeenCalledWith(WORKTREE_PATH)

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
      return url.endsWith('/api/settings/repo-external-app-recent')
    })
    expect(postCalls).toHaveLength(1)
    expect(repoClientMocks.openRepoInFinder).toHaveBeenCalledTimes(2)
  })

  test('shows an error toast when storing the recent external app fails', async () => {
    const initialSnapshot = defaultSettingsSnapshot({ repoSettings: [] })
    mockRecentAppPostFetch(initialSnapshot, { failPost: true })
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
    })

    const trigger = c.querySelector<HTMLButtonElement>('[data-testid="workspace-open-externally-menu-trigger"]')
    expect(trigger).not.toBeNull()

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

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
    expect(repoClientMocks.openRepoInFinder).toHaveBeenCalledWith(WORKTREE_PATH)
    expect(c.querySelector<HTMLButtonElement>('button[aria-label="settings.terminal.ghostty"]')).not.toBeNull()
  })

  test('reloads the scoped recent external app when the worktree path changes', async () => {
    const nextWorktreePath = '/tmp/gbl-repo-workspace-toolbar-worktree-next'
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    })
    const branchActions = menuBranchActions()

    const { container, rerender } = renderInJsdom(
      <QueryClientProvider
        client={seededQueryClientWithRepoSettings([
          {
            repoId: REPO_ID,
            workspaceExternalAppRecent: {
              byWorktree: { [WORKTREE_PATH]: 'finder', [nextWorktreePath]: 'editor:vscode' },
            },
          },
        ])}
      >
        <WorkspaceOpenExternallyMenu
          repo={repo}
          branch={createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })}
          branchActions={branchActions}
        />
      </QueryClientProvider>,
    )

    expect(container.querySelector<HTMLButtonElement>('button[aria-label="worktrees.reveal-title"]')).not.toBeNull()

    rerender(
      <QueryClientProvider
        client={seededQueryClientWithRepoSettings([
          {
            repoId: REPO_ID,
            workspaceExternalAppRecent: {
              byWorktree: { [WORKTREE_PATH]: 'finder', [nextWorktreePath]: 'editor:vscode' },
            },
          },
        ])}
      >
        <WorkspaceOpenExternallyMenu
          repo={repo}
          branch={createRepoBranch('feature/worktree', { worktree: { path: nextWorktreePath } })}
          branchActions={branchActions}
        />
      </QueryClientProvider>,
    )

    expect(container.querySelector<HTMLButtonElement>('button[aria-label="settings.editor.vscode"]')).not.toBeNull()
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="worktrees.reveal-title"]')).toBeNull()
  })

  test('hides the external app launcher in compact mode', () => {
    compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 1,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
    })

    expect(c.querySelector('button[aria-label="workspace.open-externally.open"]')).toBeNull()
    expect(c.querySelector('[data-workspace-toolbar-trailing-actions]')).toBeNull()
  })

  test('renders status and terminal tabs in one workspace tab strip with a separator', () => {
    const { container: c } = renderToolbar({
      terminalCount: 1,
      navigation: navigationWith({}),
    })

    const tablist = c.querySelector('[role="tablist"][aria-label="workspace-pane-tabs.tabs"]')
    expect(tablist).not.toBeNull()
    expect(c.querySelectorAll('[role="tablist"][aria-label="workspace-pane-tabs.tabs"]')).toHaveLength(1)
    expect(tablist?.querySelector('#workspace-status-tab')).not.toBeNull()
    expect(tablist?.querySelector('#workspace-workspace-pane-tab')).not.toBeNull()
  })

  test('renders saved mixed tab list across terminal and static tabs', () => {
    const { container: c } = renderToolbar({
      terminalCount: 1,
      workspacePaneTabs: [terminalEntry('t1'), staticEntry('status')],
      navigation: navigationWith({}),
    })

    const tabs = Array.from(c.querySelectorAll('[data-workspace-pane-tab-tooltip-id]')).map((node) =>
      node.getAttribute('data-workspace-pane-tab-tooltip-id'),
    )
    expect(tabs.slice(0, 2)).toEqual(['terminal:t1', 'workspace-pane:status'])
  })

  test('uses the workspace toolbar spacing primitives without generic toolbar gaps', () => {
    const { container: c } = renderToolbar({
      terminalCount: 3,
      navigation: navigationWith({}),
    })

    const toolbar = c.firstElementChild
    if (!(toolbar instanceof HTMLElement)) throw new Error('missing toolbar')
    const spacer = toolbar.firstElementChild
    const content = toolbar.children[1]
    if (!(spacer instanceof HTMLElement)) throw new Error('missing leading spacer')
    if (!(content instanceof HTMLElement)) throw new Error('missing workspace toolbar content')
    const primary = content.firstElementChild
    const actions = content.querySelector('[data-workspace-toolbar-trailing-actions]')
    if (!(primary instanceof HTMLElement)) throw new Error('missing workspace toolbar primary group')
    if (!(actions instanceof HTMLElement)) throw new Error('missing workspace toolbar actions group')

    expect(toolbar.children).toHaveLength(2)
    expect(toolbar.className).toContain('gap-0')
    expect(toolbar.className).not.toContain('gap-2')
    expect(spacer.className).toContain('goblin-workspace-toolbar__leading-spacer')
    expect(spacer.className).not.toContain('goblin-workspace-toolbar__leading-spacer--reserved')
    expect(content.className).toContain('goblin-workspace-toolbar__content')
    expect(primary.className).toContain('goblin-workspace-toolbar__primary')
    expect(actions.className).toContain('goblin-workspace-toolbar__actions')
  })

  test('renders static tabs from the saved workspace pane tab list without runtime materialization', async () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'history',
      workspacePaneStaticTabs: ['history', 'status'],
      navigation: navigationWith({}),
    })
    await flush()

    const tabs = Array.from(c.querySelectorAll('[data-workspace-pane-tab-tooltip-id]')).map((node) =>
      node.getAttribute('data-workspace-pane-tab-tooltip-id'),
    )
    expect(tabs.slice(0, 2)).toEqual(['workspace-pane:history', 'workspace-pane:status'])
  })

  test('closes the status static tab through the shared tab close control', async () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
    })

    const statusCloseButton = closeButtonFor(c, 'workspace-pane:status')
    expect(statusCloseButton).not.toBeNull()

    act(() => {
      statusCloseButton?.click()
    })
    await flush()

    expect(openTabsFor('feature/worktree')).toEqual([])
  })

  test('lands on the adjacent terminal after closing the active status tab', async () => {
    const showRepoWorkspacePaneTab = vi.fn()
    const { container: c } = renderToolbar({
      terminalCount: 1,
      navigation: navigationWith({ showRepoWorkspacePaneTab }),
    })

    const statusCloseButton = closeButtonFor(c, 'workspace-pane:status')
    expect(statusCloseButton).not.toBeNull()

    act(() => {
      statusCloseButton?.click()
    })
    await flush()

    expect(openTabsFor('feature/worktree')).toEqual([])
    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
  })

  test('closes a static tab without routing through runtime close', async () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'history',
      workspacePaneStaticTabs: ['history', 'status'],
      navigation: navigationWith({}),
    })

    const historyCloseButton = closeButtonFor(c, 'workspace-pane:history')
    expect(historyCloseButton).not.toBeNull()

    act(() => {
      historyCloseButton?.click()
    })
    await flush()

    expect(openTabsFor('feature/worktree')).toEqual(['status'])
  })

  test('compact workspace tab popover merges status and terminal tabs', async () => {
    compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 1,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
    })

    expect(c.querySelectorAll('[role="tab"]')).toHaveLength(1)
    expect(c.querySelector('#workspace-status-tab')).toBeNull()

    const trigger = c.querySelector<HTMLButtonElement>('button[aria-label="workspace-pane-tabs.tabs"]')
    if (!trigger) throw new Error('missing workspace tab popover trigger')

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    const list = document.body.querySelector('[role="list"]')
    expect(list?.textContent).toContain('tab.status')
    expect(list?.textContent).toContain('term-1')
    expect(document.body.textContent).toContain('terminal.new')
  })

  test('puts compact back at the start of the workspace tab row', () => {
    compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 1,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
    })

    const back = c.querySelector<HTMLButtonElement>('button[aria-label="workspace.back-to-branch-navigator"]')
    const tablist = c.querySelector('[role="tablist"][aria-label="workspace-pane-tabs.tabs"]')
    // After the refactor the back button lives at the toolbar level, so the
    // tablist is no longer a sibling of an internal "leading action" wrapper.
    // The back button is the first flex child; the strip that hosts the
    // tablist is its next sibling.
    expect(back).not.toBeNull()
    expect(tablist).not.toBeNull()
    const toolbarRow = back?.parentElement
    expect(toolbarRow).not.toBeNull()
    expect(toolbarRow?.firstElementChild).toBe(back)
    // The next sibling of the back button hosts the tablist — this nails down
    // the architectural contract that the strip lives beside (not inside) the
    // back button, so a future refactor can't silently re-couple them.
    const tabStripHost = back?.nextElementSibling
    expect(tabStripHost?.querySelector('[role="tablist"]')).toBe(tablist)

    act(() => {
      back?.click()
    })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
  })

  test('compact UI keeps the back button visible when the tab strip is empty', () => {
    compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 0,
      workspacePaneStaticTabs: [],
      workspacePaneTabs: [],
      navigation: navigationWith({}),
    })

    // Empty strip: no tabs, just the + new terminal affordance.
    expect(c.querySelectorAll('[role="tab"]')).toHaveLength(0)
    expect(c.querySelector('button[aria-label="terminal.new"]')).not.toBeNull()
    // The back button must remain visible so the user can navigate back to
    // the branch navigator — otherwise closing the status tab strands them.
    const back = c.querySelector<HTMLButtonElement>('button[aria-label="workspace.back-to-branch-navigator"]')
    expect(back).not.toBeNull()
  })

  test('non-compact UI does not render the back button in the toolbar', () => {
    compactUi = false
    const { container: c } = renderToolbar({
      terminalCount: 1,
      navigation: navigationWith({}),
    })

    // In expanded mode the toolbar delegates navigation to the branch row,
    // so the back button must stay out of the workspace pane toolbar.
    expect(c.querySelector('button[aria-label="workspace.back-to-branch-navigator"]')).toBeNull()
    // Sanity check: tabs are still rendered in expanded mode.
    expect(c.querySelectorAll('[role="tab"]').length).toBeGreaterThan(0)
  })

  test('compact workspace tab strip keeps the tab switcher available during terminal sync loading', () => {
    compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
      loading: true,
    })

    expect(c.querySelectorAll('[role="tab"]')).toHaveLength(1)
    expect(c.querySelector('button[aria-label="terminal.new"]')).toBeNull()
    expect(c.querySelector('button[aria-label="terminal.loading"]')).toBeNull()
    expect(c.querySelector('button[aria-label="workspace-pane-tabs.tabs"]')).not.toBeNull()
  })

  test('compact workspace tab strip keeps the popover switcher reachable while the terminal tab is loading', () => {
    // Regression: when the user is viewing the terminal panel while the
    // terminal session projection is still hydrating (`preferredWorkspacePaneTab =
    // 'terminal'`, no materialized terminal tabs), the toolbar's
    // `activeTabIdentity` is null because the tab-model's selection is
    // `terminal-host` with `tab: null`. The compact layout must still be
    // used (a structural choice driven by screen size) — otherwise the
    // strip falls through to the scrollable layout, which renders fixed
    // `w-36` tabs and the busy `+ New` button. The compact body shows an
    // empty tab area in this state and keeps the popover switcher
    // reachable so the user can navigate to an existing tab.
    compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
      loading: true,
    })

    const tablist = c.querySelector('[role="tablist"][aria-label="workspace-pane-tabs.tabs"]')
    const tabs = Array.from(c.querySelectorAll('[role="tab"]'))

    expect(tablist).not.toBeNull()
    expect(tablist?.className).toContain('flex-1')
    // No tab is rendered because no tab is active and no terminal is
    // materialized. The compact body renders an empty tab area + chevron.
    expect(tabs).toHaveLength(0)
    // The scrollable-layout affordances (the busy `+ New` button) must
    // stay out of the compact strip — the chevron-driven tab switcher is
    // the only way to reach the workspace pane tabs in compact mode.
    expect(c.querySelector('button[aria-label="terminal.new"]')).toBeNull()
    expect(c.querySelector('button[aria-label="terminal.loading"]')).toBeNull()
    expect(c.querySelector('button[aria-label="workspace-pane-tabs.tabs"]')).not.toBeNull()
  })

  test('compact workspace tab strip shows terminal creation as a full-width pending tab', () => {
    compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
      pendingCreate: true,
    })

    const pendingView = c.querySelector('[data-workspace-pane-pending-tab="terminal"]')
    const tab = c.querySelector('[role="tab"][aria-label="terminal.opening"]')

    expect(pendingView).not.toBeNull()
    expect(pendingView?.className).toContain('flex-1')
    expect(pendingView?.textContent).not.toContain('terminal.opening')
    expect(tab?.getAttribute('aria-busy')).toBeNull()
    expect(c.querySelector('button[aria-label="terminal.loading"]')).toBeNull()
    expect(c.querySelector('button[aria-label="workspace-pane-tabs.tabs"]')).not.toBeNull()
  })

  test('expanded workspace tab strip uses the same pending terminal tab during creation', () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
      pendingCreate: true,
    })

    const pendingView = c.querySelector('[data-workspace-pane-pending-tab="terminal"]')
    const tabs = Array.from(c.querySelectorAll('[role="tab"]'))

    expect(pendingView).not.toBeNull()
    expect(pendingView?.textContent).not.toContain('terminal.opening')
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual(['tab.status', 'terminal.opening'])
    expect(c.querySelector('[role="tab"][aria-label="terminal.opening"]')?.getAttribute('aria-busy')).toBeNull()
    const busyNewButton = c.querySelector<HTMLButtonElement>('[data-workspace-pane-new-button]')
    expect(busyNewButton).not.toBeNull()
    expect(busyNewButton?.getAttribute('aria-label')).toBe('terminal.new')
    expect(busyNewButton?.getAttribute('aria-busy')).toBe('true')
    expect(busyNewButton?.disabled).toBe(false)
    expect(busyNewButton?.querySelector('.animate-spin')).toBeNull()
  })

  test('clicking the new-terminal button navigates and creates a terminal', async () => {
    const showRepoWorkspacePaneTab = vi.fn()
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({ showRepoWorkspacePaneTab }),
    })

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(mocks.createTerminal).toHaveBeenCalledTimes(1)
  })

  test('clicking the new-terminal button keeps a reused terminal id in its existing tab position', async () => {
    const { terminalTab } = renderToolbar({
      terminalCount: 0,
      workspacePaneTabs: [terminalEntry('key'), staticEntry('status')],
      navigation: navigationWith({}),
    })

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(tabsFor('feature/worktree')).toEqual([terminalEntry('key'), staticEntry('status')])
  })

  test('shows an error toast when new terminal creation fails', async () => {
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
    })
    mocks.createTerminal.mockRejectedValueOnce(new Error('error.terminal-create-failed'))

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(toastMocks.error).toHaveBeenCalledWith('action.result-error', {
      description: 'error.terminal-create-failed',
    })
  })

  test('clicking a selected session tab when not in terminal panel navigates to terminal', async () => {
    const showRepoWorkspacePaneTab = vi.fn()
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 2,
      navigation: navigationWith({ showRepoWorkspacePaneTab }),
    })

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(mocks.createTerminal).not.toHaveBeenCalled()
    expect(mocks.selectTerminal).toHaveBeenCalledWith(`${REPO_ID}\0${WORKTREE_PATH}`, 't1')
  })

  test('clicking a selected session tab in terminal panel scrolls to bottom', async () => {
    const showRepoWorkspacePaneTab = vi.fn()
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 2,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({ showRepoWorkspacePaneTab }),
    })

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(showRepoWorkspacePaneTab).not.toHaveBeenCalled()
    expect(mocks.createTerminal).not.toHaveBeenCalled()
    expect(mocks.selectTerminal).not.toHaveBeenCalled()
    expect(mocks.scrollToBottom).toHaveBeenCalledWith('t1')
  })

  test('clicking an unselected session tab navigates and selects it', async () => {
    const showRepoWorkspacePaneTab = vi.fn()
    const { container: c, mocks } = renderToolbar({
      terminalCount: 2,
      navigation: navigationWith({ showRepoWorkspacePaneTab }),
    })

    const unselectedTab = c.querySelector<HTMLButtonElement>(
      '[data-workspace-pane-tab-tooltip-id="terminal:t2"] button[role="tab"]',
    )
    expect(unselectedTab).not.toBeNull()

    act(() => {
      unselectedTab?.click()
    })
    await flush()

    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(mocks.createTerminal).not.toHaveBeenCalled()
    expect(mocks.selectTerminal).toHaveBeenCalledWith(`${REPO_ID}\0${WORKTREE_PATH}`, 't2')
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
    compactUi = true
    const showRepoWorkspacePaneTab = vi.fn()
    const { container: c } = renderToolbar({
      terminalCount: 2,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({ showRepoWorkspacePaneTab }),
    })

    const terminalTab = c.querySelector<HTMLButtonElement>('#workspace-workspace-pane-tab')
    expect(terminalTab).not.toBeNull()

    act(() => {
      terminalTab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    await flush()

    expect(showRepoWorkspacePaneTab).not.toHaveBeenCalled()
    expect(document.activeElement?.id).toBe('workspace-workspace-pane-tab')
  })

  test('moves focus across opened status, changes, and terminal tabs with keyboard navigation', async () => {
    const showRepoWorkspacePaneTab = vi.fn()
    const { container: c } = renderToolbar({
      terminalCount: 2,
      changeCount: 1,
      workspacePaneStaticTabs: ['status', 'changes'],
      navigation: navigationWith({ showRepoWorkspacePaneTab }),
    })

    const statusTab = c.querySelector<HTMLButtonElement>('#workspace-status-tab')
    const changesTab = c.querySelector<HTMLButtonElement>('#workspace-changes-tab')
    const terminalTab = c.querySelector<HTMLButtonElement>('#workspace-workspace-pane-tab')
    if (!statusTab || !changesTab || !terminalTab) throw new Error('missing repo workspace pane tabs')

    act(() => {
      statusTab.focus()
      statusTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await flush()
    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'changes')
    expect(document.activeElement).toBe(changesTab)
    showRepoWorkspacePaneTab.mockClear()

    act(() => {
      changesTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await flush()
    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(document.activeElement).toBe(terminalTab)
    showRepoWorkspacePaneTab.mockClear()

    act(() => {
      terminalTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    await flush()
    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'changes')
    expect(document.activeElement).toBe(changesTab)
  })

  test('skips the changes tab in keyboard navigation when it is not open', async () => {
    const showRepoWorkspacePaneTab = vi.fn()
    const { container: c } = renderToolbar({
      terminalCount: 2,
      navigation: navigationWith({ showRepoWorkspacePaneTab }),
    })

    expect(c.querySelector('[data-workspace-pane-tab-tooltip-id="workspace-pane:changes"]')).toBeNull()
    const statusTab = c.querySelector<HTMLButtonElement>('#workspace-status-tab')
    const terminalTab = c.querySelector<HTMLButtonElement>('#workspace-workspace-pane-tab')
    if (!statusTab || !terminalTab) throw new Error('missing repo workspace pane tabs')

    act(() => {
      statusTab.focus()
      statusTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await flush()
    // No changes tab to land on: ArrowRight moves focus from status to terminal
    // within the same sortable workspace-pane strip.
    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(document.activeElement).toBe(terminalTab)
    showRepoWorkspacePaneTab.mockClear()

    act(() => {
      terminalTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    await flush()
    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'status')
    expect(document.activeElement).toBe(statusTab)
  })

  test('lands on the spatial neighbor after closing the active terminal tab', async () => {
    const showRepoWorkspacePaneTab = vi.fn()
    const { container: c, mocks } = renderToolbar({
      terminalCount: 1,
      workspacePaneTabs: [staticEntry('status'), terminalEntry('t1'), staticEntry('changes')],
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({ showRepoWorkspacePaneTab }),
    })

    const terminalCloseButton = c.querySelector<HTMLButtonElement>('button[aria-label^="terminal.close-named"]')
    expect(terminalCloseButton).not.toBeNull()

    act(() => {
      terminalCloseButton?.click()
    })
    await flush()

    expect(mocks.closeTerminalByDescriptor).toHaveBeenCalledWith('t1', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'changes')
  })

  test('T6.1: marks the new-terminal button busy while the initial session sync is in flight', async () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
      loading: true,
    })

    expect(c.querySelector('#workspace-status-tab')).not.toBeNull()
    const busyNewButton = c.querySelector<HTMLButtonElement>('[data-workspace-pane-new-button]')
    expect(busyNewButton).not.toBeNull()
    expect(busyNewButton?.getAttribute('aria-label')).toBe('terminal.new')
    expect(busyNewButton?.getAttribute('aria-busy')).toBe('true')
    expect(busyNewButton?.disabled).toBe(false)
    expect(busyNewButton?.querySelector('.animate-spin')).toBeNull()

    // Once the provider calls markReady() (which the real Provider
    // does at the end of syncServerSessions' finally block), the
    // busy state clears and the real button appears.
    useRepoSyncStore.getState().markReady(REPO_ID, 'repo-instance-test')
    await flush()
    expect(c.querySelector('button[aria-label="terminal.new"]')).not.toBeNull()
  })

  test('keeps the new-terminal button actionable during terminal creation', async () => {
    const { container: c, mocks } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
      pendingCreate: true,
    })

    expect(c.querySelector('[data-workspace-pane-skeleton-chip=""]')).toBeNull()
    const busyNewButton = c.querySelector<HTMLButtonElement>('[data-workspace-pane-new-button]')
    expect(busyNewButton).not.toBeNull()
    expect(busyNewButton?.getAttribute('aria-label')).toBe('terminal.new')
    expect(busyNewButton?.getAttribute('aria-busy')).toBe('true')
    expect(busyNewButton?.disabled).toBe(false)
    expect(busyNewButton?.querySelector('.animate-spin')).toBeNull()

    act(() => {
      busyNewButton?.click()
    })
    await flush()
    expect(mocks.createTerminal).toHaveBeenCalledTimes(1)
  })

  test('keeps the new-terminal button actionable during terminal creation when a terminal is already open', async () => {
    const { container: c, mocks } = renderToolbar({
      terminalCount: 1,
      navigation: navigationWith({}),
      pendingCreate: true,
    })

    expect(c.querySelector('[data-workspace-pane-tab-tooltip-id="terminal:t1"]')).not.toBeNull()
    const busyNewButton = c.querySelector<HTMLButtonElement>('[data-workspace-pane-new-button]')
    expect(busyNewButton).not.toBeNull()
    expect(busyNewButton?.getAttribute('aria-label')).toBe('terminal.new')
    expect(busyNewButton?.getAttribute('aria-busy')).toBe('true')
    expect(busyNewButton?.disabled).toBe(false)
    expect(busyNewButton?.querySelector('.animate-spin')).toBeNull()

    act(() => {
      busyNewButton?.click()
    })
    await flush()
    expect(mocks.createTerminal).toHaveBeenCalledTimes(1)
  })
})

function menuBranchActions(): BranchActions {
  return {
    blocked: false,
    busyAction: null,
    capabilities: {
      canRemoveWorktree: false,
      isRegularBranch: false,
      canCopyPatch: false,
      canPull: false,
      canPush: false,
      canOpenTerminal: true,
      canOpenEditor: true,
      canOpenFinder: true,
    },
    actions: {
      copyPatch: vi.fn(async () => false),
      pull: vi.fn(),
      push: vi.fn(),
      openTerminal: vi.fn(async () => ({ ok: true, message: '' })),
      openEditor: vi.fn(async () => ({ ok: true, message: '' })),
      openFinder: vi.fn(async () => ({ ok: true, message: '' })),
      requestDeleteBranch: vi.fn(),
      requestRemoveWorktree: vi.fn(),
    },
  }
}

function renderToolbar(options: {
  terminalCount: number
  changeCount?: number
  navigation: PrimaryWindowNavigationActions
  preferredWorkspacePaneTab?: WorkspacePaneTabType
  workspacePaneStaticTabs?: WorkspacePaneStaticTabType[]
  workspacePaneTabs?: WorkspacePaneTabEntry[]
  worktree?: boolean
  collapsed?: boolean
  pendingCreate?: boolean
  trafficLightOffset?: boolean
  remote?: Partial<RepoState['remote']>
  /**
   * When true, do NOT mark the repo ready before mounting. The toolbar
   * reads `isInitialSyncInFlight` from the store and renders the
   * New Terminal button in a busy state.
   */
  loading?: boolean
  /**
   * Pre-seed the settings snapshot's `repoSettings` field so the
   * workspace external app menu reads from server-backed state
   * without an HTTP round trip. Defaults to an empty array.
   */
  seedRepoSettings?: RepoSettingsEntry[]
}): {
  container: HTMLElement
  terminalTab: HTMLButtonElement
  rerender: ReturnType<typeof renderInJsdom>['rerender']
  queryClient: QueryClient
  mocks: {
    createTerminal: ReturnType<typeof vi.fn>
    selectTerminal: ReturnType<typeof vi.fn>
    scrollToBottom: ReturnType<typeof vi.fn>
    closeTerminalByDescriptor: ReturnType<typeof vi.fn>
    showRepoWorkspacePaneTab: ReturnType<typeof vi.fn>
  }
} {
  // Mark the repo as already-synced so the toolbar renders the normal
  // "+ New" button. Loading-state tests pass `loading: true` to skip this.
  if (!options.loading) {
    useRepoSyncStore.getState().markReady(REPO_ID, 'repo-instance-test')
  }
  const branchName = options.worktree === false ? 'feature/no-worktree' : 'feature/worktree'
  const branch = createRepoBranch(branchName, options.worktree === false ? {} : { worktree: { path: WORKTREE_PATH } })
  const repo = seedRepoState({
    id: REPO_ID,
    branches: [branch],
    selectedBranch: branchName,
    preferredWorkspacePaneTab: options.preferredWorkspacePaneTab ?? 'status',
    workspacePaneTabsByBranch:
      options.workspacePaneTabs || options.workspacePaneStaticTabs
        ? {
            [branchName]:
              options.workspacePaneTabs ?? options.workspacePaneStaticTabs?.map((type) => staticEntry(type)) ?? [],
          }
        : undefined,
    status:
      options.changeCount && options.changeCount > 0
        ? [
            {
              path: WORKTREE_PATH,
              branch: branchName,
              isMain: false,
              entries: Array.from({ length: options.changeCount }, (_, index) => ({
                x: 'M',
                y: ' ',
                path: `src/file-${index}.ts`,
              })),
            },
          ]
        : [],
    statusLoaded: true,
    remote: options.remote,
  })
  const detail = getSelectedRepoWorkspacePresentation(repo)
  const sessions: TerminalSessionSummary[] = Array.from({ length: options.terminalCount }, (_, index) => ({
    type: 'terminal',
    terminalSessionId: `t${index + 1}`,
    terminalWorktreeKey: `${REPO_ID}\0${WORKTREE_PATH}`,
    index: index + 1,
    title: `term-${index + 1}`,
    fullTitle: `full-term-${index + 1}`,
    phase: 'open' as const,
    selected: index === 0,
    hasBell: false,
    hasRecentOutput: false,
  }))
  const selectedDescriptor: TerminalDescriptor | null = sessions[0]
    ? {
        terminalSessionId: sessions[0].terminalSessionId,
        terminalWorktreeKey: sessions[0].terminalWorktreeKey,
        index: sessions[0].index,
        repoRoot: REPO_ID,
        branch: branchName,
        worktreePath: WORKTREE_PATH,
      }
    : null
  const terminalWorktreeSnapshot: TerminalWorktreeSnapshot = {
    terminalWorktreeKey: `${REPO_ID}\0${WORKTREE_PATH}`,
    selectedDescriptor,
    sessions,
    count: options.terminalCount,
    bellCount: sessions.filter((session) => session.hasBell).length,
    outputActiveCount: 0,
    pendingCreate: options.pendingCreate ?? false,
  }
  const terminalSnapshot = { phase: 'opening' as const, message: null, processName: 'terminal' }
  const readContext: TerminalSessionReadContextValue = {
    terminalWorktreeSnapshot: () => terminalWorktreeSnapshot,
    subscribeTerminalWorktree: () => () => {},
    repoBellCount: () => 0,
    subscribeRepoBellCount: () => () => {},
    snapshot: () => terminalSnapshot,
    subscribeSnapshot: () => () => {},
  }
  const createTerminal = vi.fn(async () => 'key')
  const selectTerminal = vi.fn()
  const scrollToBottom = vi.fn()
  const closeTerminalByDescriptor = vi.fn(async () => true)
  const showRepoWorkspacePaneTab = vi.fn(options.navigation.showRepoWorkspacePaneTab)
  const commandContext: TerminalSessionContextValue = {
    createTerminal,
    registerHost: vi.fn(),
    unregisterHost: vi.fn(),
    selectTerminal,
    scrollToBottom,
    scrollLines: vi.fn(),
    clearBell: vi.fn(() => false),
    closeTerminalByDescriptor,
    attach: vi.fn(),
    detach: vi.fn(),
    restart: vi.fn(),
    isTerminalFocusTarget: vi.fn(() => false),
    findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
    findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
    clearSearch: vi.fn(),
    writeInput: vi.fn(),
    takeover: vi.fn(),
    focusTerminal: vi.fn(),
  }
  setTerminalSessionCommandBridge({
    terminalWorktreeSnapshot: readContext.terminalWorktreeSnapshot,
    createTerminal,
    selectTerminal,
    closeTerminalByDescriptor,
  })

  const queryClient = new QueryClient()
  const workspacePaneTabs =
    options.workspacePaneTabs ??
    (options.workspacePaneStaticTabs || options.terminalCount > 0
      ? [
          ...(options.workspacePaneStaticTabs?.map((type) => staticEntry(type)) ?? [staticEntry('status')]),
          ...sessions.map((session) => terminalEntry(session.terminalSessionId)),
        ]
      : undefined)
  if (workspacePaneTabs) {
    const repoInstanceId = useReposStore.getState().repos[REPO_ID]!.instanceId
    const workspacePaneTabsQueryInput = {
      repoRoot: REPO_ID,
      repoInstanceId,
      branchName,
      worktreePath: options.worktree === false ? null : WORKTREE_PATH,
      tabs: workspacePaneTabs,
    }
    setWorkspacePaneTabsForTargetQueryData(workspacePaneTabsQueryInput)
    setWorkspacePaneTabsForTargetQueryData(workspacePaneTabsQueryInput, queryClient)
  }
  queryClient.setQueryData(
    settingsSnapshotQueryKey(),
    defaultSettingsSnapshot({ repoSettings: options.seedRepoSettings ?? [] }),
  )
  const { container, rerender } = renderInJsdom(
    <QueryClientProvider client={queryClient}>
      <PrimaryWindowNavigationProvider value={options.navigation}>
        <TerminalSessionContext value={commandContext}>
          <TerminalSessionReadContext value={readContext}>
            <RepoWorkspaceToolbarHarness
              repo={repo}
              detail={detail}
              workspacePaneId="workspace"
              trafficLightOffset={options.trafficLightOffset}
            />
          </TerminalSessionReadContext>
        </TerminalSessionContext>
      </PrimaryWindowNavigationProvider>
    </QueryClientProvider>,
  )

  const tabSelector =
    options.worktree === false
      ? '#workspace-status-tab'
      : options.terminalCount > 0
        ? '[data-workspace-pane-tab-tooltip-id="terminal:t1"] button[role="tab"]'
        : 'button[aria-label="terminal.new"]'
  const tab = container.querySelector<HTMLButtonElement>(tabSelector)
  if (!tab && !options.loading && !options.pendingCreate) throw new Error('missing terminal tab')
  return {
    container,
    terminalTab: tab as HTMLButtonElement,
    rerender,
    queryClient,
    mocks: {
      createTerminal,
      selectTerminal,
      scrollToBottom,
      closeTerminalByDescriptor,
      showRepoWorkspacePaneTab,
    },
  }
}

function navigationWith(overrides: Partial<PrimaryWindowNavigationActions>): PrimaryWindowNavigationActions {
  return {
    activateRepo: () => {},
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoWorkspacePaneTab: () => {},
    showRepoBranchWorkspacePaneTab: () => {},
    openSettings: () => {},
    ...overrides,
  }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function closeButtonFor(container: HTMLElement, identity: string): HTMLButtonElement | null {
  const chrome = container.querySelector(`[data-workspace-pane-tab-tooltip-id="${identity}"]`)
  if (!chrome) return null
  return (
    Array.from(chrome.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.getAttribute('aria-label')?.startsWith('workspace-pane-tabs.close-named'),
    ) ?? null
  )
}

function openTabsFor(branchName: string): WorkspacePaneStaticTabType[] {
  return workspacePaneStaticTabsFromEntries(tabsFor(branchName))
}

function tabsFor(branchName: string): WorkspacePaneTabEntry[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  const target = repo ? workspacePaneTabsTargetForRepoBranch(repo, branchName) : null
  return target ? readWorkspacePaneTabsForTarget({ ...target, repoInstanceId: repo.instanceId }) : []
}

function staticEntry(type: WorkspacePaneStaticTabType): WorkspacePaneTabEntry {
  return workspacePaneStaticTabEntry(type)
}

function terminalEntry(id: string): WorkspacePaneTabEntry {
  return workspacePaneTerminalTabEntry(id)
}

/**
 * Stub `globalThis.fetch` so the menu's `setRecentWorkspaceExternalApp`
 * call resolves cleanly. Also serves the snapshot GET — `useSettingsSnapshotQuery`
 * has `staleTime: 0`, so background refetches would otherwise throw.
 * Other URLs throw to surface unexpected traffic.
 */
function mockRecentAppPostFetch(
  initialSnapshot: object,
  options: { failPost?: boolean } = {},
): ReturnType<typeof vi.fn> {
  let currentSnapshot = initialSnapshot
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.endsWith('/api/settings/repo-external-app-recent')) {
      if (options.failPost) {
        return new Response(JSON.stringify({ ok: false }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
      }
      const body = init?.body
        ? (JSON.parse(init.body as string) as { itemId: string; worktreePath: string | null; repoId: string })
        : null
      if (body) {
        currentSnapshot = {
          ...(currentSnapshot as Record<string, unknown>),
          repoSettings: [
            {
              repoId: body.repoId,
              workspaceExternalAppRecent: { byWorktree: { [body.worktreePath ?? '']: body.itemId } },
            },
          ],
        }
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.endsWith('/api/settings') && (!init?.method || init.method === 'GET')) {
      return new Response(JSON.stringify(currentSnapshot), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`unexpected fetch in test: ${url}`)
  })
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

/**
 * Build a fresh `QueryClient` whose settings snapshot cache already
 * contains the given `repoSettings`. Used by the worktree-scope test
 * which renders `WorkspaceOpenExternallyMenu` directly (it doesn't go
 * through `renderToolbar`).
 */
function seededQueryClientWithRepoSettings(repoSettings: RepoSettingsEntry[]): QueryClient {
  const queryClient = new QueryClient()
  queryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot({ repoSettings }))
  return queryClient
}
