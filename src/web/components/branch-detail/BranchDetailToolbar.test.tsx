// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchDetailToolbar } from '#/web/components/branch-detail/BranchDetailToolbar.tsx'
import { getSelectedBranchDetailPresentation } from '#/web/components/branch-detail/model.ts'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import type { WorkspacePaneStaticViewType } from '#/shared/workspace-pane.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
  TerminalSessionSummary,
  TerminalDescriptor,
  WorktreeTerminalSnapshot,
} from '#/web/components/terminal/types.ts'
import { MainWindowNavigationProvider, type MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { emptyRendererBridgeBootstrap, setRendererBridgeForTests } from '#/web/renderer-bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { DEFAULT_WORKSPACE_LAYOUT } from '#/shared/workspace-layout.ts'
import type { RendererBridge } from '#/web/renderer-bridge-types.ts'
import type { RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'

let compactUi = false

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => compactUi,
}))

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

const REPO_ID = '/tmp/gbl-branch-detail-toolbar-repo'
const WORKTREE_PATH = '/tmp/gbl-branch-detail-toolbar-worktree'
compactUi = false

let container: HTMLDivElement | null = null
let root: Root | null = null
let queryClient: QueryClient | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  compactUi = false
  resetReposStore()
  setRendererBridgeForTests(null)
  // T6.1: the toolbar reads `isInitialSyncInFlight` from
  // useRepoSyncStore; existing tests assume the repo has been
  // synced (no skeleton). Mark ready by default so the "+ New"
  // button renders; the T6.1 test will reset the store to test
  // the loading state.
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
  setRendererBridgeForTests(null)
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('BranchDetailToolbar', () => {
  test('renders terminal affordance without default status or changes tabs', () => {
    const { container: c } = renderToolbar({ terminalCount: 0, changeCount: 3, navigation: navigationWith({}) })

    const tabs = Array.from(c.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
    expect(tabs.map((tab) => tab.id)).toEqual([])
    expect(c.querySelector('#detail-workspace-pane-view-empty')?.textContent).toContain('terminal.label')
    expect(c.querySelector('#detail-workspace-pane-view')).toBeNull()
    expect(c.querySelector('[data-workspace-pane-view-tooltip-id="status:status"]')).toBeNull()
    expect(c.querySelector('[data-workspace-pane-view-tooltip-id="changes:changes"]')).toBeNull()
    // useT is mocked to return the i18n key, so we assert against the key here.
    expect(c.querySelector('#detail-workspace-pane-view-empty')?.textContent).toContain('terminal.label')
  })

  test('clicking the new-terminal button navigates and creates a terminal', async () => {
    const showRepoWorkspacePaneView = vi.fn()
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({ showRepoWorkspacePaneView }),
    })

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(showRepoWorkspacePaneView).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(mocks.createTerminal).toHaveBeenCalledTimes(1)
  })

  test('shows an error toast when new terminal creation fails', async () => {
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 0,
      workspacePaneView: 'terminal',
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
    const showRepoWorkspacePaneView = vi.fn()
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 2,
      navigation: navigationWith({ showRepoWorkspacePaneView }),
    })

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(showRepoWorkspacePaneView).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(mocks.createTerminal).not.toHaveBeenCalled()
    expect(mocks.selectTerminal).toHaveBeenCalledWith(`${REPO_ID}\0${WORKTREE_PATH}`, 't1')
  })

  test('clicking a selected session tab in terminal panel scrolls to bottom', async () => {
    const showRepoWorkspacePaneView = vi.fn()
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 2,
      workspacePaneView: 'terminal',
      navigation: navigationWith({ showRepoWorkspacePaneView }),
    })

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(showRepoWorkspacePaneView).not.toHaveBeenCalled()
    expect(mocks.createTerminal).not.toHaveBeenCalled()
    expect(mocks.selectTerminal).not.toHaveBeenCalled()
    expect(mocks.scrollToBottom).toHaveBeenCalledWith('t1')
  })

  test('clicking an unselected session tab navigates and selects it', async () => {
    const showRepoWorkspacePaneView = vi.fn()
    const { container: c, mocks } = renderToolbar({
      terminalCount: 2,
      navigation: navigationWith({ showRepoWorkspacePaneView }),
    })

    const unselectedTab = c.querySelector<HTMLButtonElement>(
      '[data-workspace-pane-view-tooltip-id="terminal:t2"] button[role="tab"]',
    )
    expect(unselectedTab).not.toBeNull()

    act(() => {
      unselectedTab?.click()
    })
    await flush()

    expect(showRepoWorkspacePaneView).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(mocks.createTerminal).not.toHaveBeenCalled()
    expect(mocks.selectTerminal).toHaveBeenCalledWith(`${REPO_ID}\0${WORKTREE_PATH}`, 't2')
  })

  test('does not show branch actions in the detail bar (actions moved to branch rows)', () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
    })

    expect(c.querySelector('button[aria-label="action.menu"]')).toBeNull()
    expect(c.querySelector('[data-testid="branch-detail-toolbar-divider"]')).toBeNull()
  })

  test('keeps terminal focus when pressing End on the compact terminal view', async () => {
    compactUi = true
    const showRepoWorkspacePaneView = vi.fn()
    const { container: c } = renderToolbar({
      terminalCount: 2,
      workspacePaneView: 'terminal',
      navigation: navigationWith({ showRepoWorkspacePaneView }),
    })

    const terminalTab = c.querySelector<HTMLButtonElement>('#detail-workspace-pane-view')
    expect(terminalTab).not.toBeNull()

    act(() => {
      terminalTab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    await flush()

    expect(showRepoWorkspacePaneView).not.toHaveBeenCalled()
    expect(document.activeElement?.id).toBe('detail-workspace-pane-view')
  })

  test('moves focus across opened status, changes, and terminal views with keyboard navigation', async () => {
    const showRepoWorkspacePaneView = vi.fn()
    const { container: c } = renderToolbar({
      terminalCount: 2,
      changeCount: 1,
      staticWorkspaceViewTypes: ['status', 'changes'],
      navigation: navigationWith({ showRepoWorkspacePaneView }),
    })

    const statusTab = c.querySelector<HTMLButtonElement>('#detail-workspace-pane-view')
    const changesTab = c.querySelector<HTMLButtonElement>('#detail-workspace-pane-view-1')
    const terminalTab = c.querySelector<HTMLButtonElement>('#detail-workspace-pane-view-2')
    if (!statusTab || !changesTab || !terminalTab) throw new Error('missing branch workspace pane views')

    act(() => {
      statusTab.focus()
      statusTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await flush()
    expect(showRepoWorkspacePaneView).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(changesTab)

    act(() => {
      changesTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await flush()
    expect(showRepoWorkspacePaneView).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(terminalTab)

    act(() => {
      terminalTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    await flush()
    expect(showRepoWorkspacePaneView).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(changesTab)
  })

  test('skips the changes tab in keyboard navigation when it is not open', async () => {
    const showRepoWorkspacePaneView = vi.fn()
    const { container: c } = renderToolbar({
      terminalCount: 2,
      staticWorkspaceViewTypes: ['status'],
      navigation: navigationWith({ showRepoWorkspacePaneView }),
    })

    expect(c.querySelector('[data-workspace-pane-view-tooltip-id="changes:changes"]')).toBeNull()
    const statusTab = c.querySelector<HTMLButtonElement>('#detail-workspace-pane-view')
    const terminalTab = c.querySelector<HTMLButtonElement>('#detail-workspace-pane-view-1')
    if (!statusTab || !terminalTab) throw new Error('missing branch workspace pane views')

    act(() => {
      statusTab.focus()
      statusTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await flush()
    // No changes tab to land on — ArrowRight from status jumps to terminal.
    expect(showRepoWorkspacePaneView).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(terminalTab)

    act(() => {
      terminalTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    await flush()
    expect(showRepoWorkspacePaneView).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(statusTab)
  })

  test('selects the adjacent static workspace pane view after closing the active terminal view', async () => {
    const showRepoWorkspacePaneView = vi.fn()
    const { container: c, mocks } = renderToolbar({
      terminalCount: 1,
      staticWorkspaceViewTypes: ['status', 'changes'],
      workspacePaneView: 'terminal',
      navigation: navigationWith({ showRepoWorkspacePaneView }),
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
    expect(showRepoWorkspacePaneView).toHaveBeenCalledWith(REPO_ID, 'changes')
  })

  test('T6.1: renders a single skeleton placeholder chip while the initial session sync is in flight', async () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
      loading: true,
    })

    // The skeleton marker is present; the real button is not.
    expect(c.querySelector('[data-workspace-pane-skeleton-strip=""]')).not.toBeNull()
    expect(c.querySelectorAll('[data-workspace-pane-skeleton-chip=""]')).toHaveLength(1)
    expect(c.querySelector('#detail-workspace-pane-view')).toBeNull()
    // role="status" + aria-busy for assistive tech.
    const strip = c.querySelector('[role="status"][aria-busy="true"]')
    expect(strip).not.toBeNull()

    // Once the provider calls markReady() (which the real Provider
    // does at the end of syncServerSessions' finally block), the
    // skeleton disappears and the real button appears.
    useRepoSyncStore.getState().markReady(REPO_ID, 0)
    await flush()
    expect(c.querySelector('[data-workspace-pane-skeleton-strip=""]')).toBeNull()
    expect(c.querySelector('#detail-workspace-pane-view-empty')).not.toBeNull()
  })
})

function renderToolbar(options: {
  terminalCount: number
  changeCount?: number
  navigation: MainWindowNavigationActions
  workspacePaneView?: 'status' | 'changes' | 'terminal'
  staticWorkspaceViewTypes?: WorkspacePaneStaticViewType[]
  detailFocusMode?: boolean
  collapsed?: boolean
  layout?: RepoWorkspaceLayout
  /**
   * T6.1: when true, do NOT mark the repo ready before mounting.
   * The toolbar reads `isInitialSyncInFlight` from the store and
   * renders the single-skeleton-chip loading state instead of the
   * "+ New" button. The T6.1 test uses this; all other tests use
   * the default (false) so the existing assertions still find
   * `#detail-workspace-pane-view-empty`.
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
    showRepoWorkspacePaneView: ReturnType<typeof vi.fn>
  }
} {
  // T6.1: mark the repo as already-synced so the toolbar renders
  // the "+ New" button instead of the single placeholder skeleton chip.
  // The T6.1 skeleton test passes `loading: true` to skip this and
  // exercise the loading state.
  if (!options.loading) {
    useRepoSyncStore.getState().markReady(REPO_ID, 0)
  }
  const repo = seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    selectedBranch: 'feature/worktree',
    workspacePaneView: options.workspacePaneView ?? 'status',
    status:
      options.changeCount && options.changeCount > 0
        ? [
            {
              path: WORKTREE_PATH,
              branch: 'feature/worktree',
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
  })
  const detail = getSelectedBranchDetailPresentation(repo)
  const staticWorkspacePaneViews = (options.staticWorkspaceViewTypes ?? []).map((type, index) => ({
    type,
    id: type,
    key: type,
    worktreeTerminalKey: `${REPO_ID}\0${WORKTREE_PATH}`,
    worktreePath: WORKTREE_PATH,
    displayOrder: index + 1,
  }))
  const sessions: TerminalSessionSummary[] = Array.from({ length: options.terminalCount }, (_, index) => ({
    type: 'terminal',
    id: `t${index + 1}`,
    key: `t${index + 1}`,
    worktreeTerminalKey: `${REPO_ID}\0${WORKTREE_PATH}`,
    terminalId: `t${index + 1}`,
    index: index + 1,
    displayOrder: staticWorkspacePaneViews.length + index + 1,
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
        terminalId: sessions[0].terminalId,
        index: sessions[0].index,
        repoRoot: REPO_ID,
        branch: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
      }
    : null
  const worktreeSnapshot: WorktreeTerminalSnapshot = {
    worktreeTerminalKey: `${REPO_ID}\0${WORKTREE_PATH}`,
    selectedDescriptor,
    sessions,
    staticWorkspacePaneViews,
    workspacePaneViews: [...staticWorkspacePaneViews, ...sessions],
    count: options.terminalCount,
    pendingCreate: false,
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
  const closeTerminalByDescriptor = vi.fn()
  const showRepoWorkspacePaneView = vi.fn(options.navigation.showRepoWorkspacePaneView)
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
    openWorkspacePaneView: vi.fn(async () => true),
    closeWorkspacePaneView: vi.fn(async () => true),
    reorderWorkspacePaneViews: vi.fn(async () => true),
    serialize: vi.fn(() => ''),
  }

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
              <BranchDetailToolbar
                repo={repo}
                detail={detail}
                detailId="detail"
                contentId="content"
                collapsed={options.collapsed ?? false}
                detailFocusMode={options.detailFocusMode ?? false}
                layout={options.layout ?? DEFAULT_WORKSPACE_LAYOUT}
              />
            </TerminalSessionReadContext.Provider>
          </TerminalSessionContext.Provider>
        </MainWindowNavigationProvider>
      </QueryClientProvider>,
    )
  })

  const tab = container.querySelector<HTMLButtonElement>('#detail-workspace-pane-view-empty, #detail-workspace-pane-view')
  if (!tab && !options.loading) throw new Error('missing terminal view')
  return {
    container,
    terminalTab: tab as HTMLButtonElement,
    mocks: {
      createTerminal,
      selectTerminal,
      scrollToBottom,
      closeTerminalByDescriptor,
      showRepoWorkspacePaneView,
    },
  }
}

function navigationWith(overrides: Partial<MainWindowNavigationActions>): MainWindowNavigationActions {
  return {
    activateRepo: () => {},
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoWorkspacePaneView: () => {},
    showRepoBranchWorkspacePaneView: () => {},
    openSettings: () => {},
    ...overrides,
  }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
