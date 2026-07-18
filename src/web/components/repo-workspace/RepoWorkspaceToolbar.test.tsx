// @vitest-environment jsdom

import { act } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoWorkspaceToolbar } from '#/web/components/repo-workspace/RepoWorkspaceToolbar.tsx'
import { WorkspaceOpenExternallyMenu } from '#/web/components/repo-workspace/WorkspaceOpenExternallyMenu.tsx'
import {
  getCurrentRepoWorkspacePresentation as buildRepoWorkspacePresentation,
  type RepoWorkspaceRepo,
} from '#/web/components/repo-workspace/model.ts'
import { useRepoWorkspaceTabModel } from '#/web/components/repo-workspace/use-repo-workspace-tab-model.ts'
import { formatTerminalWorktreeKeyForPath } from '#/shared/terminal-worktree-key.ts'
import { terminalSessionBaseForTest } from '#/web/test-utils/terminal-model.ts'
import { useBranchActions, type BranchActions } from '#/web/hooks/useBranchActions.tsx'
import {
  EMPTY_TERMINAL_SNAPSHOT,
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  WorkspacePaneStaticTabType,
  WorkspacePaneTabEntry,
  WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import {
  isWorkspacePaneStaticTabType,
  workspacePaneStaticTabEntry,
  workspacePaneRuntimeTabEntry,
} from '#/shared/workspace-pane.ts'
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
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import type { WorkspacePaneRoute } from '#/web/App.tsx'
import {
  terminalExecutionPath,
  terminalPresentationBranch,
  terminalSessionCoordinates,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import {
  createBranchSnapshot,
  installWorkspacePaneTabsTestBridge,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { workspacePaneTabsTargetForRepoBranch } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import { workspacePaneStaticTabsFromEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { setTerminalSessionCommandBridgeForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { terminalSessionContextForTest } from '#/web/test-utils/terminal-session-context.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import type { RepoSettingsEntry } from '#/shared/repo-settings.ts'
import {
  observeWorkspacePaneRouteForTest,
  observedWorkspacePaneRouteCommitForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'

let compactUi = false
let workspacePaneTabsTestBridge: ReturnType<typeof installWorkspacePaneTabsTestBridge>
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

const REPO_ID = 'goblin+file:///tmp/goblin-repo-workspace-toolbar-repo'
const WORKTREE_PATH = '/tmp/goblin-repo-workspace-toolbar-worktree'
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
> & { workspacePaneRoute: WorkspacePaneRoute | null | undefined }

function RepoWorkspaceToolbarHarness(props: RepoWorkspaceToolbarHarnessProps) {
  const workspacePaneTabModel = useRepoWorkspaceTabModel(props.repo, props.detail, props.workspacePaneRoute)
  const branchActions = useBranchActions(props.repo, props.detail.branch!)
  return <RepoWorkspaceToolbar {...props} workspacePaneTabModel={workspacePaneTabModel} branchActions={branchActions} />
}

function getTestRepoWorkspacePresentation(repo: RepoWorkspaceRepo) {
  return buildRepoWorkspacePresentation(repo, { loading: false, error: null, stale: false })
}

function repoWorkspaceRepo(repo: WorkspaceState): RepoWorkspaceRepo {
  const branchModel = readRepoBranchQueryProjection(repo)
  if (!branchModel) throw new Error('missing branch read model')
  return {
    ...repo,
    ui: { ...repo.ui, currentBranchName: branchModel.branches[0]?.name ?? null },
    branchAction: repo.operations.branchAction,
    branchModel,
    unavailable: false,
  }
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
  resetWorkspacesStore()
  workspacePaneTabsTestBridge = installWorkspacePaneTabsTestBridge()
  // T6.1: the toolbar reads `isInitialSyncInFlight` from
  // useTerminalProjectionHydrationStore; existing tests assume the repo has been
  // synced. Mark ready by default so the "+ New" button renders; the
  // loading-state test skips this and expects the same button to be busy.
  useTerminalProjectionHydrationStore.setState({ hydrationByRepo: new Map(), refreshedAtByRepo: new Map() })
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
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const { container: c, terminalTab } = renderToolbar({
      terminalCount: 0,
      worktree: false,
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
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

    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
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
    expect(repoClientMocks.openRepoInFinder).toHaveBeenCalledWith(REPO_ID, WORKTREE_PATH)

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
    expect(repoClientMocks.openRepoInFinder).toHaveBeenCalledWith(REPO_ID, WORKTREE_PATH)
    expect(c.querySelector<HTMLButtonElement>('button[aria-label="settings.terminal.ghostty"]')).not.toBeNull()
  })

  test('reloads the scoped recent external app when the worktree path changes', async () => {
    const nextWorktreePath = '/tmp/goblin-repo-workspace-toolbar-worktree-next'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
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
          repo={repoWorkspaceRepo(repo)}
          branch={createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })}
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
          repo={repoWorkspaceRepo(repo)}
          branch={createBranchSnapshot('feature/worktree', { worktree: { path: nextWorktreePath } })}
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
      workspacePaneTabs: [terminalEntry('term-111111111111111111111'), staticEntry('status')],
      navigation: navigationWith({}),
    })

    const tabs = Array.from(c.querySelectorAll('[data-workspace-pane-tab-tooltip-id]')).map((node) =>
      node.getAttribute('data-workspace-pane-tab-tooltip-id'),
    )
    expect(tabs.slice(0, 2)).toEqual(['terminal:term-111111111111111111111', 'workspace-pane:status'])
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
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const { container: c } = renderToolbar({
      terminalCount: 1,
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession }),
    })

    const statusCloseButton = closeButtonFor(c, 'workspace-pane:status')
    expect(statusCloseButton).not.toBeNull()

    act(() => {
      statusCloseButton?.click()
    })
    await flush()

    expect(openTabsFor('feature/worktree')).toEqual([])
    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-111111111111111111111',
    )
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('closes a terminal tab through the shared tab close control', async () => {
    const { container: c, mocks } = renderToolbar({
      terminalCount: 1,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
    })

    const terminalCloseButton = closeButtonFor(c, 'terminal:term-111111111111111111111')
    expect(terminalCloseButton).not.toBeNull()

    act(() => {
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
    // `runtime-host` with no materialized tab. The compact layout must still be
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
      createPending: true,
    })

    const pendingView = c.querySelector('[data-workspace-pane-pending-tab="terminal"]')
    const tab = c.querySelector('[role="tab"][aria-label="terminal.opening"]')

    expect(pendingView).not.toBeNull()
    expect(pendingView?.className).toContain('flex-1')
    expect(pendingView?.textContent).not.toContain('terminal.opening')
    expect(tab?.getAttribute('aria-busy')).toBeNull()
    expect(tab?.getAttribute('aria-selected')).toBe('true')
    expect(c.querySelector('button[aria-label="terminal.loading"]')).toBeNull()
    expect(c.querySelector('button[aria-label="workspace-pane-tabs.tabs"]')).not.toBeNull()
  })

  test('expanded workspace tab strip uses the same pending terminal tab during creation', () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
      createPending: true,
    })

    const pendingView = c.querySelector('[data-workspace-pane-pending-tab="terminal"]')
    const tabs = Array.from(c.querySelectorAll('[role="tab"]'))

    expect(pendingView).not.toBeNull()
    expect(pendingView?.textContent).not.toContain('terminal.opening')
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual(['tab.status', 'terminal.opening'])
    const pendingTab = c.querySelector('[role="tab"][aria-label="terminal.opening"]')
    expect(pendingTab?.getAttribute('aria-busy')).toBeNull()
    expect(pendingTab?.getAttribute('aria-selected')).toBe('true')
    const busyNewButton = c.querySelector<HTMLButtonElement>('[data-workspace-pane-new-button]')
    expect(busyNewButton).not.toBeNull()
    expect(busyNewButton?.getAttribute('aria-label')).toBe('terminal.new')
    expect(busyNewButton?.getAttribute('aria-busy')).toBe('true')
    expect(busyNewButton?.disabled).toBe(true)
    expect(busyNewButton?.querySelector('.animate-spin')).toBeNull()
  })

  test('clicking the new-terminal button navigates and creates a terminal', async () => {
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession }),
    })

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-111111111111111111111',
    )
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(mocks.createTerminal).toHaveBeenCalledTimes(1)
  })

  test('clicking the new-terminal button keeps a reused terminal id in its existing tab position', async () => {
    const { terminalTab } = renderToolbar({
      terminalCount: 0,
      workspacePaneTabs: [terminalEntry('term-111111111111111111111'), staticEntry('status')],
      navigation: navigationWith({}),
    })

    act(() => {
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

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(toastMocks.error).toHaveBeenCalledWith('action.result-error', {
      description: 'error.terminal-create-failed',
    })
  })

  test('clicking a selected session tab when not in terminal panel navigates to terminal', async () => {
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 2,
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession }),
    })

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-111111111111111111111',
    )
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(mocks.createTerminal).not.toHaveBeenCalled()
    expect(mocks.selectTerminal).not.toHaveBeenCalled()
  })

  test('clicking a selected session tab in terminal panel scrolls to bottom', async () => {
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 2,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession }),
    })

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(showRepoBranchTerminalSession).not.toHaveBeenCalled()
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(mocks.createTerminal).not.toHaveBeenCalled()
    expect(mocks.selectTerminal).not.toHaveBeenCalled()
    expect(mocks.scrollToBottom).toHaveBeenCalledWith('term-111111111111111111111')
  })

  test('clicking an unselected session tab navigates and selects it', async () => {
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const { container: c, mocks } = renderToolbar({
      terminalCount: 2,
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession }),
    })

    const unselectedTab = c.querySelector<HTMLButtonElement>(
      '[data-workspace-pane-tab-tooltip-id="terminal:term-222222222222222222222"] button[role="tab"]',
    )
    expect(unselectedTab).not.toBeNull()

    act(() => {
      unselectedTab?.click()
    })
    await flush()

    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-222222222222222222222',
    )
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(mocks.createTerminal).not.toHaveBeenCalled()
    expect(mocks.selectTerminal).not.toHaveBeenCalled()
  })

  test('selects a tab against the current worktree target after its path changes', async () => {
    const nextWorktreePath = '/tmp/goblin-repo-workspace-toolbar-worktree-relocated'
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const { container: c, rerenderWorktreePath } = renderToolbar({
      terminalCount: 0,
      workspacePaneStaticTabs: ['status', 'files'],
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
    })

    rerenderWorktreePath(nextWorktreePath)
    const filesTab = c.querySelector<HTMLButtonElement>(
      '[data-workspace-pane-tab-tooltip-id="workspace-pane:files"] button[role="tab"]',
    )
    expect(filesTab).not.toBeNull()

    act(() => filesTab?.click())
    await flush()

    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'files')
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
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const { container: c } = renderToolbar({
      terminalCount: 2,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
    })

    const terminalTab = c.querySelector<HTMLButtonElement>('#workspace-workspace-pane-tab')
    expect(terminalTab).not.toBeNull()

    act(() => {
      terminalTab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    await flush()

    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(document.activeElement?.id).toBe('workspace-workspace-pane-tab')
  })

  test('moves focus across opened status, changes, and terminal tabs with keyboard navigation', async () => {
    const showRepoBranchWorkspacePaneTab = vi.fn<PrimaryWindowNavigationActions['showRepoBranchWorkspacePaneTab']>(
      () => true,
    )
    const showRepoBranchTerminalSession = vi.fn<PrimaryWindowNavigationActions['showRepoBranchTerminalSession']>(
      () => true,
    )
    const commitWorkspacePaneRoute: PrimaryWindowNavigationActions['commitWorkspacePaneRoute'] = (
      repoId,
      branchName,
      route,
      options,
    ) => {
      const accepted =
        route === null
          ? true
          : route.kind === 'static'
            ? showRepoBranchWorkspacePaneTab(repoId, branchName, route.tab)
            : showRepoBranchTerminalSession(repoId, branchName, route.terminalSessionId)
      if (accepted) options?.onCommit?.()
      return accepted
    }
    const { container: c } = renderToolbar({
      terminalCount: 2,
      changeCount: 1,
      workspacePaneStaticTabs: ['status', 'changes'],
      navigation: navigationWith({
        showRepoBranchWorkspacePaneTab,
        showRepoBranchTerminalSession,
        commitWorkspacePaneRoute,
      }),
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
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'changes')
    expect(document.activeElement).toBe(changesTab)
    showRepoBranchWorkspacePaneTab.mockClear()

    act(() => {
      changesTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await flush()
    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-111111111111111111111',
    )
    expect(document.activeElement).toBe(terminalTab)
    showRepoBranchWorkspacePaneTab.mockClear()
    showRepoBranchTerminalSession.mockClear()

    act(() => {
      terminalTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    await flush()
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'changes')
    expect(document.activeElement).toBe(changesTab)
  })

  test('skips the changes tab in keyboard navigation when it is not open', async () => {
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const { container: c } = renderToolbar({
      terminalCount: 2,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession }),
    })

    expect(c.querySelector('[data-workspace-pane-tab-tooltip-id="workspace-pane:changes"]')).toBeNull()
    const statusTab = c.querySelector<HTMLButtonElement>('#workspace-status-tab')
    const terminalTab = c.querySelector<HTMLButtonElement>('#workspace-workspace-pane-tab')
    if (!statusTab || !terminalTab) throw new Error('missing repo workspace pane tabs')

    act(() => {
      terminalTab.focus()
      terminalTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    await flush()
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'status')
    expect(document.activeElement).toBe(statusTab)
  })

  test('lands on the spatial neighbor after closing the active terminal tab', async () => {
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const { container: c, mocks } = renderToolbar({
      terminalCount: 1,
      workspacePaneTabs: [staticEntry('status'), terminalEntry('term-111111111111111111111'), staticEntry('changes')],
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
    })

    const terminalCloseButton = c.querySelector<HTMLButtonElement>('button[aria-label^="terminal.close-named"]')
    expect(terminalCloseButton).not.toBeNull()

    act(() => {
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
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'changes')
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

    act(() => {
      newButton?.click()
    })
    await flush()
    expect(mocks.createTerminal).toHaveBeenCalledOnce()
  })

  test('opens a terminal for the current runtime when only a stale runtime projection is hydrated', async () => {
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, 'repo-runtime-old')
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

    act(() => {
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

    act(() => {
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

    act(() => {
      busyNewButton?.click()
    })
    await flush()
    expect(mocks.createTerminal).not.toHaveBeenCalled()
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
  createPending?: boolean
  trafficLightOffset?: boolean
  remote?: Partial<WorkspaceState['remote']>
  workspaceRuntimeId?: string
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
  rerenderWorktreePath: (worktreePath: string) => void
  queryClient: QueryClient
  mocks: {
    createTerminal: ReturnType<typeof vi.fn>
    selectTerminal: ReturnType<typeof vi.fn>
    scrollToBottom: ReturnType<typeof vi.fn>
    closeTerminalByDescriptor: ReturnType<typeof vi.fn>
    showRepoBranchWorkspacePaneTab: ReturnType<typeof vi.fn>
    showRepoBranchTerminalSession: ReturnType<typeof vi.fn>
  }
} {
  const branchName = options.worktree === false ? 'feature/no-worktree' : 'feature/worktree'
  const branch = createBranchSnapshot(
    branchName,
    options.worktree === false ? {} : { worktree: { path: WORKTREE_PATH } },
  )
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    workspaceRuntimeId: options.workspaceRuntimeId,
    branchSnapshots: [branch],
    currentBranchName: branchName,
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
    remote: options.remote,
  })
  // Mark the repo as already-synced so the toolbar renders the normal
  // "+ New" button. Loading-state tests pass `loading: true` to skip this.
  if (!options.loading) {
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
  }
  const detail = getTestRepoWorkspacePresentation(repoWorkspaceRepo(repo))
  const sessions: TerminalSessionSummary[] = Array.from({ length: options.terminalCount }, (_, index) => ({
    type: 'terminal',
    terminalSessionId: `term-${String(index + 1).repeat(21)}`,
    terminalWorktreeKey: formatTerminalWorktreeKeyForPath(REPO_ID, WORKTREE_PATH),
    index: index + 1,
    title: `term-${index + 1}`,
    fullTitle: `full-term-${index + 1}`,
    phase: 'open' as const,
    selected: index === 0,
    hasBell: false,
    hasRecentOutput: false,
  }))
  const preferredWorkspacePaneTab = options.preferredWorkspacePaneTab ?? 'status'
  const workspacePaneRoute = workspacePaneRouteForPreferredTab(preferredWorkspacePaneTab, sessions)
  const selectedDescriptor: TerminalDescriptor | null = sessions[0]
    ? {
        terminalSessionId: sessions[0].terminalSessionId,
        index: sessions[0].index,
        target: {
          kind: 'git-worktree' as const,
          workspaceId: canonicalWorkspaceLocator(REPO_ID)!,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          root: canonicalWorkspaceLocator(`goblin+file://${WORKTREE_PATH}`)!,
        },
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: branchName } },
      }
    : null
  const terminalWorktreeSnapshot: TerminalWorktreeSnapshot = {
    terminalWorktreeKey: formatTerminalWorktreeKeyForPath(REPO_ID, WORKTREE_PATH),
    selectedDescriptor,
    sessions,
    count: options.terminalCount,
    bellCount: sessions.filter((session) => session.hasBell).length,
    outputActiveCount: 0,
    createPending: options.createPending ?? false,
  }
  const terminalSnapshot = EMPTY_TERMINAL_SNAPSHOT
  const readContext: TerminalSessionReadContextValue = {
    terminalWorktreeSnapshot: () => terminalWorktreeSnapshot,
    subscribeTerminalWorktree: () => () => {},
    workspaceBellCount: () => 0,
    subscribeWorkspaceBellCount: () => () => {},
    snapshot: () => terminalSnapshot,
    subscribeSnapshot: () => () => {},
  }
  const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
    const terminalSessionId = 'term-111111111111111111111'
    const coordinates = terminalSessionCoordinates(base)
    const branchName = terminalPresentationBranch(base.presentation)
    if (!branchName) throw new Error('expected Git worktree terminal fixture')
    workspacePaneTabsTestBridge.addRuntimeTab({
      repoRoot: coordinates.repoRoot,
      workspaceRuntimeId: coordinates.workspaceRuntimeId,
      branchName,
      worktreePath: terminalExecutionPath(base.target),
      terminalSessionId,
    })
    return terminalSessionId
  })
  const selectTerminal = vi.fn()
  const scrollToBottom = vi.fn()
  const closeTerminalByDescriptor = vi.fn(async () => true)
  const showRepoBranchWorkspacePaneTab = vi.fn(options.navigation.showRepoBranchWorkspacePaneTab)
  const showRepoBranchTerminalSession = vi.fn(options.navigation.showRepoBranchTerminalSession)
  const commandContext: TerminalSessionContextValue = terminalSessionContextForTest({
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
  })
  setTerminalSessionCommandBridge({
    terminalWorktreeSnapshot: readContext.terminalWorktreeSnapshot,
    createTerminal,
    selectTerminal,
    closeTerminalByDescriptor,
  })

  const queryClient = new QueryClient()
  const workspacePaneTabs = options.workspacePaneTabs ?? [
    ...(options.workspacePaneStaticTabs?.map((type) => staticEntry(type)) ?? [staticEntry('status')]),
    ...sessions.map((session) => terminalEntry(session.terminalSessionId)),
  ]
  if (workspacePaneTabs) {
    const workspaceRuntimeId = useWorkspacesStore.getState().workspaces[REPO_ID]!.workspaceRuntimeId
    const workspacePaneTabsQueryInput = {
      repoRoot: REPO_ID,
      workspaceRuntimeId,
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
  const navigation = navigationWith({
    ...options.navigation,
    showRepoBranchWorkspacePaneTab,
    showRepoBranchTerminalSession,
  })
  const { container, rerender } = renderInJsdom(
    <QueryClientProvider client={queryClient}>
      <PrimaryWindowNavigationProvider value={navigation}>
        <TerminalSessionContext value={commandContext}>
          <TerminalSessionReadContext value={readContext}>
            <RepoWorkspaceToolbarHarness
              repo={repoWorkspaceRepo(repo)}
              detail={detail}
              workspacePaneId="workspace"
              workspacePaneRoute={workspacePaneRoute}
              trafficLightOffset={options.trafficLightOffset}
            />
          </TerminalSessionReadContext>
        </TerminalSessionContext>
      </PrimaryWindowNavigationProvider>
    </QueryClientProvider>,
  )

  const rerenderWorktreePath = (worktreePath: string) => {
    const nextBranch = createBranchSnapshot(branchName, { worktree: { path: worktreePath } })
    const nextRepo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchSnapshots: [nextBranch],
      currentBranchName: branchName,
      preferredWorkspacePaneTab,
    })
    const nextTabsInput = {
      repoRoot: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName,
      worktreePath,
      tabs: workspacePaneTabs,
    }
    setWorkspacePaneTabsForTargetQueryData(nextTabsInput)
    setWorkspacePaneTabsForTargetQueryData(nextTabsInput, queryClient)
    observeWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName,
      worktreePath,
      route: workspacePaneRoute,
    })
    rerender(
      <QueryClientProvider client={queryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={commandContext}>
            <TerminalSessionReadContext value={readContext}>
              <RepoWorkspaceToolbarHarness
                repo={repoWorkspaceRepo(nextRepo)}
                detail={getTestRepoWorkspacePresentation(repoWorkspaceRepo(nextRepo))}
                workspacePaneId="workspace"
                workspacePaneRoute={workspacePaneRoute}
                trafficLightOffset={options.trafficLightOffset}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )
  }

  const tabSelector =
    options.worktree === false
      ? '#workspace-status-tab'
      : options.terminalCount > 0
        ? '[data-workspace-pane-tab-tooltip-id="terminal:term-111111111111111111111"] button[role="tab"]'
        : 'button[aria-label="terminal.new"]'
  const tab = container.querySelector<HTMLButtonElement>(tabSelector)
  if (!tab && !options.loading && !options.createPending) throw new Error('missing terminal tab')
  return {
    container,
    terminalTab: tab as HTMLButtonElement,
    rerender,
    rerenderWorktreePath,
    queryClient,
    mocks: {
      createTerminal,
      selectTerminal,
      scrollToBottom,
      closeTerminalByDescriptor,
      showRepoBranchWorkspacePaneTab,
      showRepoBranchTerminalSession,
    },
  }
}

function workspacePaneRouteForPreferredTab(
  preferredTab: WorkspacePaneTabType,
  sessions: readonly TerminalSessionSummary[],
): WorkspacePaneRoute | null {
  if (preferredTab === 'terminal') {
    return { kind: 'terminal', terminalSessionId: sessions[0]?.terminalSessionId ?? 'pending-terminal' }
  }
  return isWorkspacePaneStaticTabType(preferredTab) ? { kind: 'static', tab: preferredTab } : null
}

function navigationWith(overrides: Partial<PrimaryWindowNavigationActions>): PrimaryWindowNavigationActions {
  seedInitialObservedWorkspacePaneRouteForTest()
  const navigation: PrimaryWindowNavigationActions = {
    activateWorkspace: () => {},
    closeWorkspace: async () => ({ ok: true }),
    cycleWorkspace: () => {},
    selectRepoBranch: () => true,
    showRepoBranchEmptyWorkspacePane: () => true,
    showRepoBranchWorkspacePaneTab: () => true,
    showRepoBranchTerminalSession: () => true,
    commitWorkspacePaneRoute: () => false,
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
    currentWorkspacePaneRoute: overrides.currentWorkspacePaneRoute ?? (() => undefined),
  }
  if (!overrides.commitWorkspacePaneRoute) {
    navigation.commitWorkspacePaneRoute = observedWorkspacePaneRouteCommitForTest(navigation)
  }
  return navigation
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function closeButtonFor(container: HTMLElement, identity: string): HTMLButtonElement | null {
  const chrome = container.querySelector(`[data-workspace-pane-tab-tooltip-id="${identity}"]`)
  if (!chrome) return null
  return (
    Array.from(chrome.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      /^(workspace-pane-tabs\.close-named|terminal\.close-named)/.test(button.getAttribute('aria-label') ?? ''),
    ) ?? null
  )
}

function openTabsFor(branchName: string): WorkspacePaneStaticTabType[] {
  return workspacePaneStaticTabsFromEntries(tabsFor(branchName))
}

function tabsFor(branchName: string): WorkspacePaneTabEntry[] {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  const target = repo
    ? workspacePaneTabsTargetForRepoBranch(
        { repoRoot: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
        branchName,
      )
    : null
  return target ? readWorkspacePaneTabsForTarget({ ...target, workspaceRuntimeId: repo.workspaceRuntimeId }) : []
}

function workspaceRuntimeIdForTest(): string {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  if (!repo) throw new Error(`expected seeded repo ${REPO_ID}`)
  return repo.workspaceRuntimeId
}

function staticEntry(type: WorkspacePaneStaticTabType): WorkspacePaneTabEntry {
  return workspacePaneStaticTabEntry(type)
}

function terminalEntry(id: string): WorkspacePaneTabEntry {
  return workspacePaneRuntimeTabEntry('terminal', id)
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
