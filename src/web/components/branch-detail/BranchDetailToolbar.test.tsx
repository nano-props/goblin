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
  test('renders status and changes tabs with separator and terminal area', () => {
    const { container: c } = renderToolbar({ terminalCount: 0, changeCount: 3, navigation: navigationWith({}) })

    const tabs = Array.from(c.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
    expect(tabs.map((tab) => tab.id)).toEqual(['detail-status-tab', 'detail-changes-tab'])
    expect(c.querySelector('[aria-label="tab.branch-detail"]')?.className).toContain('h-full')
    expect(c.querySelector('#detail-changes-tab')?.textContent).toContain('3')
    // useT is mocked to return the i18n key, so we assert against the key here.
    expect(c.querySelector('#detail-terminal-tab')?.textContent).toContain('terminal.label')
  })

  test('clicking the new-terminal button navigates and creates a terminal', async () => {
    const showRepoDetailTab = vi.fn()
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({ showRepoDetailTab }),
    })

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(showRepoDetailTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(mocks.createTerminal).toHaveBeenCalledTimes(1)
  })

  test('shows an error toast when new terminal creation fails', async () => {
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 0,
      detailTab: 'terminal',
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
    const showRepoDetailTab = vi.fn()
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 2,
      navigation: navigationWith({ showRepoDetailTab }),
    })

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(showRepoDetailTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(mocks.createTerminal).not.toHaveBeenCalled()
    expect(mocks.selectTerminal).toHaveBeenCalledWith(`${REPO_ID}\0${WORKTREE_PATH}`, 't1')
  })

  test('clicking a selected session tab in terminal panel scrolls to bottom', async () => {
    const showRepoDetailTab = vi.fn()
    const { terminalTab, mocks } = renderToolbar({
      terminalCount: 2,
      detailTab: 'terminal',
      navigation: navigationWith({ showRepoDetailTab }),
    })

    act(() => {
      terminalTab.click()
    })
    await flush()

    expect(showRepoDetailTab).not.toHaveBeenCalled()
    expect(mocks.createTerminal).not.toHaveBeenCalled()
    expect(mocks.selectTerminal).not.toHaveBeenCalled()
    expect(mocks.scrollToBottom).toHaveBeenCalledWith('t1')
  })

  test('clicking an unselected session tab navigates and selects it', async () => {
    const showRepoDetailTab = vi.fn()
    const { container: c, mocks } = renderToolbar({
      terminalCount: 2,
      navigation: navigationWith({ showRepoDetailTab }),
    })

    const unselectedTab = c.querySelector<HTMLButtonElement>('[data-terminal-tab-tooltip-id="t2"] button[role="tab"]')
    expect(unselectedTab).not.toBeNull()

    act(() => {
      unselectedTab?.click()
    })
    await flush()

    expect(showRepoDetailTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
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

  test('keeps terminal focus when pressing End on the compact terminal tab', async () => {
    compactUi = true
    const showRepoDetailTab = vi.fn()
    const { container: c } = renderToolbar({
      terminalCount: 2,
      detailTab: 'terminal',
      navigation: navigationWith({ showRepoDetailTab }),
    })

    const terminalTab = c.querySelector<HTMLButtonElement>('#detail-terminal-tab')
    expect(terminalTab).not.toBeNull()

    act(() => {
      terminalTab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    await flush()

    expect(showRepoDetailTab).not.toHaveBeenCalled()
    expect(document.activeElement?.id).toBe('detail-terminal-tab')
  })

  test('moves focus across status, changes, and terminal tabs with keyboard navigation', async () => {
    const showRepoDetailTab = vi.fn()
    const { container: c } = renderToolbar({
      terminalCount: 2,
      changeCount: 1,
      navigation: navigationWith({ showRepoDetailTab }),
    })

    const statusTab = c.querySelector<HTMLButtonElement>('#detail-status-tab')
    const changesTab = c.querySelector<HTMLButtonElement>('#detail-changes-tab')
    const terminalTab = c.querySelector<HTMLButtonElement>('#detail-terminal-tab')
    if (!statusTab || !changesTab || !terminalTab) throw new Error('missing branch detail tabs')

    act(() => {
      statusTab.focus()
      statusTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await flush()
    expect(showRepoDetailTab).toHaveBeenNthCalledWith(1, REPO_ID, 'changes')
    expect(document.activeElement).toBe(changesTab)

    act(() => {
      changesTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await flush()
    expect(showRepoDetailTab).toHaveBeenNthCalledWith(2, REPO_ID, 'terminal')
    expect(document.activeElement).toBe(terminalTab)

    act(() => {
      terminalTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    await flush()
    expect(showRepoDetailTab).toHaveBeenNthCalledWith(3, REPO_ID, 'changes')
    expect(document.activeElement).toBe(changesTab)
  })

  test('skips the changes tab in keyboard navigation when the worktree is clean', async () => {
    const showRepoDetailTab = vi.fn()
    const { container: c } = renderToolbar({
      terminalCount: 2,
      // no changeCount — worktree is clean
      navigation: navigationWith({ showRepoDetailTab }),
    })

    expect(c.querySelector('#detail-changes-tab')).toBeNull()
    const statusTab = c.querySelector<HTMLButtonElement>('#detail-status-tab')
    const terminalTab = c.querySelector<HTMLButtonElement>('#detail-terminal-tab')
    if (!statusTab || !terminalTab) throw new Error('missing branch detail tabs')

    act(() => {
      statusTab.focus()
      statusTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    await flush()
    // No changes tab to land on — ArrowRight from status jumps to terminal.
    expect(showRepoDetailTab).toHaveBeenLastCalledWith(REPO_ID, 'terminal')
    expect(document.activeElement).toBe(terminalTab)

    act(() => {
      terminalTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    await flush()
    expect(showRepoDetailTab).toHaveBeenLastCalledWith(REPO_ID, 'status')
    expect(document.activeElement).toBe(statusTab)
  })

  test('T6.1: renders 3 skeleton placeholder chips while the initial session sync is in flight', async () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
      loading: true,
    })

    // The skeleton markers are present; the real button is not.
    expect(c.querySelector('[data-terminal-skeleton-strip=""]')).not.toBeNull()
    expect(c.querySelectorAll('[data-terminal-skeleton-chip=""]')).toHaveLength(3)
    expect(c.querySelector('#detail-terminal-tab')).toBeNull()
    // role="status" + aria-busy for assistive tech.
    const strip = c.querySelector('[role="status"][aria-busy="true"]')
    expect(strip).not.toBeNull()

    // Once the provider calls markReady() (which the real Provider
    // does at the end of syncServerSessions' finally block), the
    // skeleton disappears and the real button appears.
    useRepoSyncStore.getState().markReady(REPO_ID, 0)
    await flush()
    expect(c.querySelector('[data-terminal-skeleton-strip=""]')).toBeNull()
    expect(c.querySelector('#detail-terminal-tab')).not.toBeNull()
  })
})

function renderToolbar(options: {
  terminalCount: number
  changeCount?: number
  navigation: MainWindowNavigationActions
  detailTab?: 'status' | 'changes' | 'terminal'
  detailFocusMode?: boolean
  collapsed?: boolean
  layout?: RepoWorkspaceLayout
  /**
   * T6.1: when true, do NOT mark the repo ready before mounting.
   * The toolbar reads `isInitialSyncInFlight` from the store and
   * renders the 3-skeleton-chip loading state instead of the
   * "+ New" button. The T6.1 test uses this; all other tests use
   * the default (false) so the existing assertions still find
   * `#detail-terminal-tab`.
   */
  loading?: boolean
}): {
  container: HTMLDivElement
  terminalTab: HTMLButtonElement
  mocks: {
    createTerminal: ReturnType<typeof vi.fn>
    selectTerminal: ReturnType<typeof vi.fn>
    scrollToBottom: ReturnType<typeof vi.fn>
    showRepoDetailTab: ReturnType<typeof vi.fn>
  }
} {
  // T6.1: mark the repo as already-synced so the toolbar renders
  // the "+ New" button instead of the 3 placeholder skeleton chips.
  // The T6.1 skeleton test passes `loading: true` to skip this and
  // exercise the loading state.
  if (!options.loading) {
    useRepoSyncStore.getState().markReady(REPO_ID, 0)
  }
  const repo = seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    selectedBranch: 'feature/worktree',
    detailTab: options.detailTab ?? 'status',
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
  const sessions: TerminalSessionSummary[] = Array.from({ length: options.terminalCount }, (_, index) => ({
    key: `t${index + 1}`,
    worktreeTerminalKey: `${REPO_ID}\0${WORKTREE_PATH}`,
    terminalId: `t${index + 1}`,
    index: index + 1,
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
  const showRepoDetailTab = vi.fn(options.navigation.showRepoDetailTab)
  const commandContext: TerminalSessionContextValue = {
    createTerminal,
    registerHost: vi.fn(),
    unregisterHost: vi.fn(),
    selectTerminal,
    scrollToBottom,
    scrollLines: vi.fn(),
    clearBell: vi.fn(() => false),
    closeTerminalByDescriptor: vi.fn(() => []),
    attach: vi.fn(),
    detach: vi.fn(),
    restart: vi.fn(),
    isTerminalFocusTarget: vi.fn(() => false),
    findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
    findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
    clearSearch: vi.fn(),
    writeInput: vi.fn(),
    takeover: vi.fn(),
    reorderSessions: vi.fn(async () => true),
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

  const tab = container.querySelector<HTMLButtonElement>('#detail-terminal-tab')
  if (!tab && !options.loading) throw new Error('missing terminal tab')
  return {
    container,
    terminalTab: tab as HTMLButtonElement,
    mocks: {
      createTerminal,
      selectTerminal,
      scrollToBottom,
      showRepoDetailTab,
    },
  }
}

function navigationWith(overrides: Partial<MainWindowNavigationActions>): MainWindowNavigationActions {
  return {
    activateRepo: () => {},
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoDetailTab: () => {},
    showRepoBranchDetailTab: () => {},
    openSettings: () => {},
    ...overrides,
  }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
