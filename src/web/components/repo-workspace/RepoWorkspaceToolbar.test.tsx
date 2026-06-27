// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
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
  WorkspacePaneTabOrderEntry,
  WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabOrderEntry } from '#/shared/workspace-pane.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
  TerminalSessionSummary,
  TerminalDescriptor,
  WorktreeTerminalSnapshot,
} from '#/web/components/terminal/types.ts'
import { MainWindowNavigationProvider, type MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import {
  WORKSPACE_EXTERNAL_APP_RECENT_STORAGE_KEY,
  workspaceExternalAppRecentScope,
} from '#/web/workspace-external-apps-recent.ts'
import {
  workspacePaneStaticViewsForBranch,
  workspacePaneTabOrderForBranch,
} from '#/web/stores/repos/workspace-pane-tabs.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'

let compactUi = false
const runtimeExternalAppSettings = vi.hoisted(() => ({
  value: {
    terminalAvailable: true,
    terminalAppAvailability: { ghostty: true, terminal: true, windowsTerminal: false },
    editorAvailable: true,
    editorAppAvailability: { vscode: true, cursor: true, windsurf: true },
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
    editorAppAvailability: { vscode: true, cursor: true, windsurf: true },
  }
}

let container: HTMLDivElement | null = null
let root: Root | null = null
let queryClient: QueryClient | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

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
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  compactUi = false
  runtimeExternalAppSettings.value = defaultRuntimeExternalAppSettings()
  appShellMocks.openExternalUrl.mockReset()
  repoClientMocks.openRepoInFinder.mockReset()
  repoClientMocks.openRepoInFinder.mockImplementation(async (path: string) => ({ ok: true, message: path }))
  useHostInfoStore.setState({
    snapshot: { homeDir: '/Users/tester', platform: 'darwin', hostname: 'test-host', pid: 1 },
    hydrated: true,
  })
  window.localStorage.clear()
  resetReposStore()
  setClientBridgeForTests(null)
  // T6.1: the toolbar reads `isInitialSyncInFlight` from
  // useRepoSyncStore; existing tests assume the repo has been
  // synced. Mark ready by default so the "+ New" button renders; the
  // loading-state test skips this and expects the same button to be busy.
  useRepoSyncStore.setState({ ready: new Map(), timestamps: new Map() })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  queryClient = null
  toastMocks.error.mockClear()
  appShellMocks.openExternalUrl.mockReset()
  repoClientMocks.openRepoInFinder.mockReset()
  useHostInfoStore.setState({ snapshot: null, hydrated: false })
  window.localStorage.clear()
  setClientBridgeForTests(null)
  setTerminalSessionCommandBridge(null)
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
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
    expect(c.querySelector('[data-workspace-pane-tab-tooltip-id="status:status"]')).not.toBeNull()
    expect(c.querySelector('[data-workspace-pane-tab-tooltip-id="changes:changes"]')).toBeNull()
  })

  test('renders the external app launcher at the workspace toolbar right edge', async () => {
    runtimeExternalAppSettings.value = {
      ...defaultRuntimeExternalAppSettings(),
      editorAppAvailability: { vscode: true, cursor: true, windsurf: false },
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
      'settings.editor.cursor',
      'worktrees.reveal-title',
    ])
    expect(document.body.textContent).not.toContain('settings.editor.windsurf')
  })

  test('renders the remote/PR item in the open-externally dropdown', async () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
      remote: { hasBrowserRemote: true, browserRemoteProvider: 'github' },
    })

    const trigger = c.querySelector<HTMLButtonElement>('[data-testid="workspace-open-externally-menu-trigger"]')
    expect(trigger).not.toBeNull()

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    const menuItems = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="listitem"] button')).map(
      (button) => button.textContent,
    )
    expect(menuItems).toContain('workspace.open-externally.remote')
    expect(document.body.textContent).toContain('workspace.open-externally.remote')
  })

  test('renders the open-externally menu for remote only when no local external apps are available', async () => {
    useHostInfoStore.setState({
      snapshot: { homeDir: '/Users/tester', platform: 'win32', hostname: 'test-host', pid: 1 },
    })
    runtimeExternalAppSettings.value = {
      terminalAvailable: false,
      terminalAppAvailability: { ghostty: false, terminal: false, windowsTerminal: false },
      editorAvailable: false,
      editorAppAvailability: { vscode: false, cursor: false, windsurf: false },
    }
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
      remote: { hasBrowserRemote: true, browserRemoteProvider: 'github' },
    })

    const trigger = c.querySelector<HTMLButtonElement>('[data-testid="workspace-open-externally-menu-trigger"]')
    expect(trigger).not.toBeNull()

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    const menuItems = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="listitem"] button')).map(
      (button) => button.textContent,
    )
    expect(menuItems).toEqual(['workspace.open-externally.remote'])
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
      await Promise.resolve()
    })

    expect(
      window.localStorage.getItem(
        `${WORKSPACE_EXTERNAL_APP_RECENT_STORAGE_KEY}:${workspaceExternalAppRecentScope(REPO_ID, WORKTREE_PATH)}`,
      ),
    ).toBe('finder')
    expect(repoClientMocks.openRepoInFinder).toHaveBeenCalledWith(WORKTREE_PATH)

    const primary = c.querySelector<HTMLButtonElement>('button[aria-label="worktrees.reveal-title"]')
    expect(primary).not.toBeNull()

    await act(async () => {
      primary?.click()
      await Promise.resolve()
    })

    expect(repoClientMocks.openRepoInFinder).toHaveBeenCalledTimes(2)
  })

  test('reloads the scoped recent external app when the worktree path changes', async () => {
    const nextWorktreePath = '/tmp/gbl-repo-workspace-toolbar-worktree-next'
    window.localStorage.setItem(
      `${WORKSPACE_EXTERNAL_APP_RECENT_STORAGE_KEY}:${workspaceExternalAppRecentScope(REPO_ID, WORKTREE_PATH)}`,
      'finder',
    )
    window.localStorage.setItem(
      `${WORKSPACE_EXTERNAL_APP_RECENT_STORAGE_KEY}:${workspaceExternalAppRecentScope(REPO_ID, nextWorktreePath)}`,
      'editor:vscode',
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    })
    const branchActions = menuBranchActions()

    await act(async () => {
      root!.render(
        <WorkspaceOpenExternallyMenu
          repo={repo}
          branch={createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })}
          branchActions={branchActions}
        />,
      )
      await Promise.resolve()
    })

    expect(container.querySelector<HTMLButtonElement>('button[aria-label="worktrees.reveal-title"]')).not.toBeNull()

    await act(async () => {
      root!.render(
        <WorkspaceOpenExternallyMenu
          repo={repo}
          branch={createRepoBranch('feature/worktree', { worktree: { path: nextWorktreePath } })}
          branchActions={branchActions}
        />,
      )
      await Promise.resolve()
    })

    expect(container.querySelector<HTMLButtonElement>('button[aria-label="settings.editor.vscode"]')).not.toBeNull()
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="worktrees.reveal-title"]')).toBeNull()
  })

  test('keeps the external app launcher reachable in compact mode', () => {
    compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 1,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
    })

    expect(c.querySelector('button[aria-label="workspace.open-externally.open"]')).not.toBeNull()
  })

  test('renders status and terminal views in one workspace tab strip with a separator', () => {
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

  test('renders saved unified tab order across terminal and static tabs', () => {
    const { container: c } = renderToolbar({
      terminalCount: 1,
      workspacePaneTabOrder: [terminalEntry('t1'), staticEntry('status')],
      navigation: navigationWith({}),
    })

    const tabs = Array.from(c.querySelectorAll('[data-workspace-pane-tab-tooltip-id]')).map((node) =>
      node.getAttribute('data-workspace-pane-tab-tooltip-id'),
    )
    expect(tabs.slice(0, 2)).toEqual(['terminal:t1', 'status:status'])
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

  test('renders static tabs in saved workspace pane order without runtime materialization', async () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'history',
      workspacePaneStaticViews: ['history', 'status'],
      navigation: navigationWith({}),
    })
    await flush()

    const tabs = Array.from(c.querySelectorAll('[data-workspace-pane-tab-tooltip-id]')).map((node) =>
      node.getAttribute('data-workspace-pane-tab-tooltip-id'),
    )
    expect(tabs.slice(0, 2)).toEqual(['history:history', 'status:status'])
  })

  test('closes the status static tab through the shared tab close control', async () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
    })

    const statusCloseButton = closeButtonFor(c, 'status:status')
    expect(statusCloseButton).not.toBeNull()

    act(() => {
      statusCloseButton?.click()
    })
    await flush()

    expect(openViewsFor('feature/worktree')).toEqual([])
  })

  test('records the closing context for spatial adjacency after closing the active status tab', async () => {
    const showRepoWorkspacePaneTab = vi.fn()
    const { container: c } = renderToolbar({
      terminalCount: 1,
      navigation: navigationWith({ showRepoWorkspacePaneTab }),
    })

    const statusCloseButton = closeButtonFor(c, 'status:status')
    expect(statusCloseButton).not.toBeNull()

    act(() => {
      statusCloseButton?.click()
    })
    await flush()

    expect(openViewsFor('feature/worktree')).toEqual([])
    // The X-click records the closing context for the workspace pane tab
    // model. The model itself decides where to land — the close command does
    // not imperatively navigate, so navigation is untouched here.
    expect(showRepoWorkspacePaneTab).not.toHaveBeenCalled()
    expect(useReposStore.getState().repos[REPO_ID]?.ui.lastClosedTabContextByBranch['feature/worktree']).toEqual({
      closingIdentity: 'status:status',
      previousTabIdentities: ['status:status', 'terminal:t1'],
      wasActive: true,
    })
  })

  test('closes a static tab without routing through runtime close', async () => {
    const { container: c, mocks } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'history',
      workspacePaneStaticViews: ['history', 'status'],
      navigation: navigationWith({}),
    })

    const historyCloseButton = closeButtonFor(c, 'history:history')
    expect(historyCloseButton).not.toBeNull()

    act(() => {
      historyCloseButton?.click()
    })
    await flush()

    expect(openViewsFor('feature/worktree')).toEqual(['status'])
  })

  test('compact workspace view popover merges status and terminal views', async () => {
    compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 1,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
    })

    expect(c.querySelectorAll('[role="tab"]')).toHaveLength(1)
    expect(c.querySelector('#workspace-status-tab')).toBeNull()

    const trigger = c.querySelector<HTMLButtonElement>('button[aria-label="workspace-pane-tabs.tabs"]')
    if (!trigger) throw new Error('missing workspace view popover trigger')

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
    const viewStripHost = back?.nextElementSibling
    expect(viewStripHost?.querySelector('[role="tablist"]')).toBe(tablist)

    act(() => {
      back?.click()
    })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
  })

  test('compact UI keeps the back button visible when the tab strip is empty', () => {
    compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 0,
      workspacePaneStaticViews: [],
      workspacePaneTabOrder: [],
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

  test('compact workspace view keeps the tab switcher available during terminal sync loading', () => {
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

  test('compact workspace view keeps the popover switcher reachable while the terminal view is loading', () => {
    // Regression: when the user is viewing the terminal panel while the
    // terminal registry is still hydrating (`preferredWorkspacePaneTab =
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
    // the only way to reach the workspace pane views in compact mode.
    expect(c.querySelector('button[aria-label="terminal.new"]')).toBeNull()
    expect(c.querySelector('button[aria-label="terminal.loading"]')).toBeNull()
    expect(c.querySelector('button[aria-label="workspace-pane-tabs.tabs"]')).not.toBeNull()
  })

  test('compact workspace view shows terminal creation as a full-width pending tab', () => {
    compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
      pendingCreate: true,
    })

    const pendingView = c.querySelector('[data-workspace-pane-pending-view="terminal"]')
    const tab = c.querySelector('[role="tab"][aria-label="terminal.opening"]')

    expect(pendingView).not.toBeNull()
    expect(pendingView?.className).toContain('flex-1')
    expect(pendingView?.textContent).not.toContain('terminal.opening')
    expect(tab?.getAttribute('aria-busy')).toBe('true')
    expect(c.querySelector('button[aria-label="terminal.loading"]')).toBeNull()
    expect(c.querySelector('button[aria-label="workspace-pane-tabs.tabs"]')).not.toBeNull()
  })

  test('expanded workspace view uses the same pending terminal tab during creation', () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
      pendingCreate: true,
    })

    const pendingView = c.querySelector('[data-workspace-pane-pending-view="terminal"]')
    const tabs = Array.from(c.querySelectorAll('[role="tab"]'))

    expect(pendingView).not.toBeNull()
    expect(pendingView?.textContent).not.toContain('terminal.opening')
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual(['tab.status', 'terminal.opening'])
    expect(c.querySelector('[role="tab"][aria-label="terminal.opening"]')?.getAttribute('aria-busy')).toBe('true')
    expect(c.querySelector('button[aria-label="terminal.loading"]')).not.toBeNull()
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

  test('clicking the new-terminal button moves a reused stale terminal id to the end', async () => {
    const { terminalTab } = renderToolbar({
      terminalCount: 0,
      workspacePaneTabOrder: [terminalEntry('key'), staticEntry('status')],
      navigation: navigationWith({}),
    })

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(tabOrderFor('feature/worktree')).toEqual([staticEntry('status'), terminalEntry('key')])
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

  test('keeps terminal focus when pressing End on the compact terminal view', async () => {
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

  test('moves focus across opened status, changes, and terminal views with keyboard navigation', async () => {
    const showRepoWorkspacePaneTab = vi.fn()
    const { container: c } = renderToolbar({
      terminalCount: 2,
      changeCount: 1,
      workspacePaneStaticViews: ['status', 'changes'],
      navigation: navigationWith({ showRepoWorkspacePaneTab }),
    })

    const statusTab = c.querySelector<HTMLButtonElement>('#workspace-status-tab')
    const changesTab = c.querySelector<HTMLButtonElement>('#workspace-changes-tab')
    const terminalTab = c.querySelector<HTMLButtonElement>('#workspace-workspace-pane-tab')
    if (!statusTab || !changesTab || !terminalTab) throw new Error('missing branch workspace pane views')

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

    expect(c.querySelector('[data-workspace-pane-tab-tooltip-id="changes:changes"]')).toBeNull()
    const statusTab = c.querySelector<HTMLButtonElement>('#workspace-status-tab')
    const terminalTab = c.querySelector<HTMLButtonElement>('#workspace-workspace-pane-tab')
    if (!statusTab || !terminalTab) throw new Error('missing branch workspace pane views')

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

  test('records the closing context for spatial adjacency after closing the active terminal view', async () => {
    const showRepoWorkspacePaneTab = vi.fn()
    const { container: c, mocks } = renderToolbar({
      terminalCount: 1,
      workspacePaneTabOrder: [staticEntry('status'), terminalEntry('t1'), staticEntry('changes')],
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
    // The X-click records the closing context so the workspace pane tab model
    // can land on changes (the spatial neighbor) at read time. Navigation is
    // untouched here — the model is the single source of truth.
    expect(showRepoWorkspacePaneTab).not.toHaveBeenCalled()
    expect(useReposStore.getState().repos[REPO_ID]?.ui.lastClosedTabContextByBranch['feature/worktree']).toEqual({
      closingIdentity: 'terminal:t1',
      previousTabIdentities: ['status:status', 'terminal:t1', 'changes:changes'],
      wasActive: true,
    })
  })

  test('T6.1: renders a busy new-terminal button while the initial session sync is in flight', async () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
      loading: true,
    })

    expect(c.querySelector('#workspace-status-tab')).not.toBeNull()
    const busyNewButton = c.querySelector<HTMLButtonElement>('button[aria-label="terminal.loading"]')
    expect(busyNewButton).not.toBeNull()
    expect(busyNewButton?.getAttribute('aria-busy')).toBe('true')
    expect(busyNewButton?.disabled).toBe(true)

    // Once the provider calls markReady() (which the real Provider
    // does at the end of syncServerSlots' finally block), the
    // busy state clears and the real button appears.
    useRepoSyncStore.getState().markReady(REPO_ID, 0)
    await flush()
    expect(c.querySelector('button[aria-label="terminal.loading"]')).toBeNull()
    expect(c.querySelector('button[aria-label="terminal.new"]')).not.toBeNull()
  })

  test('renders terminal creation loading on the new-terminal button', () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
      pendingCreate: true,
    })

    expect(c.querySelector('[data-workspace-pane-skeleton-chip=""]')).toBeNull()
    const busyNewButton = c.querySelector<HTMLButtonElement>('button[aria-label="terminal.loading"]')
    expect(busyNewButton).not.toBeNull()
    expect(busyNewButton?.disabled).toBe(true)
  })

  test('renders terminal creation loading on the new-terminal button when a terminal is already open', () => {
    const { container: c, mocks } = renderToolbar({
      terminalCount: 1,
      navigation: navigationWith({}),
      pendingCreate: true,
    })

    expect(c.querySelector('[data-workspace-pane-tab-tooltip-id="terminal:t1"]')).not.toBeNull()
    expect(c.querySelector('button[aria-label="terminal.new"]')).toBeNull()
    const busyNewButton = c.querySelector<HTMLButtonElement>('button[aria-label="terminal.loading"]')
    expect(busyNewButton).not.toBeNull()
    expect(busyNewButton?.getAttribute('aria-busy')).toBe('true')
    expect(busyNewButton?.disabled).toBe(true)

    busyNewButton?.click()
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
      canOpenRemote: false,
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
      openRemote: vi.fn(async () => ({ ok: true, message: '' })),
      requestDeleteBranch: vi.fn(),
      requestRemoveWorktree: vi.fn(),
    },
  }
}

function renderToolbar(options: {
  terminalCount: number
  changeCount?: number
  navigation: MainWindowNavigationActions
  preferredWorkspacePaneTab?: WorkspacePaneTabType
  workspacePaneStaticViews?: WorkspacePaneStaticTabType[]
  workspacePaneTabOrder?: WorkspacePaneTabOrderEntry[]
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
}): {
  container: HTMLDivElement
  terminalTab: HTMLButtonElement
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
    useRepoSyncStore.getState().markReady(REPO_ID, 0)
  }
  const branchName = options.worktree === false ? 'feature/no-worktree' : 'feature/worktree'
  const branch = createRepoBranch(branchName, options.worktree === false ? {} : { worktree: { path: WORKTREE_PATH } })
  const repo = seedRepoState({
    id: REPO_ID,
    branches: [branch],
    selectedBranch: branchName,
    preferredWorkspacePaneTab: options.preferredWorkspacePaneTab ?? 'status',
    workspacePaneTabOrderByBranch:
      options.workspacePaneTabOrder || options.workspacePaneStaticViews
        ? {
            [branchName]:
              options.workspacePaneTabOrder ?? options.workspacePaneStaticViews?.map((type) => staticEntry(type)) ?? [],
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
    id: `t${index + 1}`,
    key: `t${index + 1}`,
    worktreeTerminalKey: `${REPO_ID}\0${WORKTREE_PATH}`,
    slotId: `t${index + 1}`,
    index: index + 1,
    displayOrder: index + 1,
    title: `term-${index + 1}`,
    fullTitle: `full-term-${index + 1}`,
    phase: 'open' as const,
    selected: index === 0,
    hasBell: false,
  }))
  const selectedDescriptor: TerminalDescriptor | null = sessions[0]
    ? {
        key: sessions[0].key,
        worktreeTerminalKey: sessions[0].worktreeTerminalKey,
        slotId: sessions[0].slotId,
        index: sessions[0].index,
        repoRoot: REPO_ID,
        branch: branchName,
        worktreePath: WORKTREE_PATH,
      }
    : null
  const worktreeSnapshot: WorktreeTerminalSnapshot = {
    worktreeTerminalKey: `${REPO_ID}\0${WORKTREE_PATH}`,
    selectedDescriptor,
    sessions,
    count: options.terminalCount,
    bellCount: sessions.filter((session) => session.hasBell).length,
    pendingCreate: options.pendingCreate ?? false,
  }
  const terminalSnapshot = { phase: 'opening' as const, message: null, processName: 'terminal' }
  const readContext: TerminalSessionReadContextValue = {
    worktreeSnapshot: () => worktreeSnapshot,
    subscribeWorktree: () => () => {},
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
    serialize: vi.fn(() => ''),
  }
  setTerminalSessionCommandBridge({
    worktreeSnapshot: readContext.worktreeSnapshot,
    createTerminal,
    selectTerminal,
    closeTerminalByDescriptor,
  })

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  queryClient = new QueryClient()
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient!}>
        <MainWindowNavigationProvider value={options.navigation}>
          <TerminalSessionContext.Provider value={commandContext}>
            <TerminalSessionReadContext.Provider value={readContext}>
              <RepoWorkspaceToolbarHarness
                repo={repo}
                detail={detail}
                workspacePaneId="workspace"
                trafficLightOffset={options.trafficLightOffset}
              />
            </TerminalSessionReadContext.Provider>
          </TerminalSessionContext.Provider>
        </MainWindowNavigationProvider>
      </QueryClientProvider>,
    )
  })

  const tabSelector =
    options.worktree === false
      ? '#workspace-status-tab'
      : options.terminalCount > 0
        ? '[data-workspace-pane-tab-tooltip-id="terminal:t1"] button[role="tab"]'
        : 'button[aria-label="terminal.new"]'
  const tab = container.querySelector<HTMLButtonElement>(tabSelector)
  if (!tab && !options.loading && !options.pendingCreate) throw new Error('missing terminal view')
  return {
    container,
    terminalTab: tab as HTMLButtonElement,
    mocks: {
      createTerminal,
      selectTerminal,
      scrollToBottom,
      closeTerminalByDescriptor,
      showRepoWorkspacePaneTab,
    },
  }
}

function ToolbarHost(props: Omit<Parameters<typeof RepoWorkspaceToolbar>[0], 'branchActions'>) {
  const branchActions = useBranchActions(props.repo, props.detail.branch!)
  return <RepoWorkspaceToolbar {...props} branchActions={branchActions} />
}

function navigationWith(overrides: Partial<MainWindowNavigationActions>): MainWindowNavigationActions {
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

function openViewsFor(branchName: string): WorkspacePaneStaticTabType[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? workspacePaneStaticViewsForBranch(repo.ui, branchName) : []
}

function tabOrderFor(branchName: string): WorkspacePaneTabOrderEntry[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? workspacePaneTabOrderForBranch(repo.ui, branchName) : []
}

function staticEntry(type: WorkspacePaneStaticTabType): WorkspacePaneTabOrderEntry {
  return workspacePaneStaticTabOrderEntry(type)
}

function terminalEntry(id: string): WorkspacePaneTabOrderEntry {
  return { type: 'terminal', id }
}
