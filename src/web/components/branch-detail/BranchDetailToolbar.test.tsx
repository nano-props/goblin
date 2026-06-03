// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchDetailToolbar } from '#/web/components/branch-detail/BranchDetailToolbar.tsx'
import { getSelectedBranchDetailPresentation } from '#/web/components/branch-detail/model.ts'
import { TerminalSessionReadContext } from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'
import { MainWindowNavigationProvider, type MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { emptyRendererBridgeBootstrap, setRendererBridgeForTests } from '#/web/renderer-bridge.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { DEFAULT_WORKSPACE_LAYOUT } from '#/shared/workspace-layout.ts'
import type { RendererBridge } from '#/web/renderer-bridge-types.ts'

const REPO_ID = '/tmp/gbl-branch-detail-toolbar-repo'
const WORKTREE_PATH = '/tmp/gbl-branch-detail-toolbar-worktree'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  setRendererBridgeForTests(null)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  setRendererBridgeForTests(null)
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('BranchDetailToolbar', () => {
  test('clicking the terminal tab only navigates and does not create a terminal', async () => {
    const create = vi.fn(async () => ({ ok: true as const, action: 'created' as const, key: 'k', sessions: [] }))
    setRendererBridgeForTests(rendererBridgeWith({ create }))
    const showRepoDetailTab = vi.fn()
    const tab = renderToolbar({ terminalCount: 0, navigation: navigationWith({ showRepoDetailTab }) })

    act(() => {
      tab.click()
    })
    await flush()

    expect(showRepoDetailTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(create).not.toHaveBeenCalled()
  })

  test('shows the terminal count badge and does not create anything on click', async () => {
    const create = vi.fn(async () => ({ ok: true as const, action: 'reused' as const, key: 'k', sessions: [] }))
    setRendererBridgeForTests(rendererBridgeWith({ create }))
    const showRepoDetailTab = vi.fn()
    const tab = renderToolbar({ terminalCount: 2, navigation: navigationWith({ showRepoDetailTab }) })

    act(() => {
      tab.click()
    })
    await flush()

    expect(showRepoDetailTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(create).not.toHaveBeenCalled()
    expect(tab.textContent).toContain('2')
  })
})

function renderToolbar(options: { terminalCount: number; navigation: MainWindowNavigationActions }): HTMLButtonElement {
  const repo = seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    selectedBranch: 'feature/worktree',
    detailTab: 'status',
  })
  const detail = getSelectedBranchDetailPresentation(repo)
  const worktreeSnapshot = {
    worktreeTerminalKey: `${REPO_ID}\0${WORKTREE_PATH}`,
    selectedDescriptor: null,
    sessions: [],
    count: options.terminalCount,
  }
  const terminalSnapshot = { phase: 'opening' as const, message: null, processName: 'terminal' }
  const readContext: TerminalSessionReadContextValue = {
    worktreeSnapshot: () => worktreeSnapshot,
    subscribeWorktree: () => () => {},
    repoSyncReady: () => false,
    subscribeRepoSync: () => () => {},
    snapshot: () => terminalSnapshot,
    subscribeSnapshot: () => () => {},
  }

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <MainWindowNavigationProvider value={options.navigation}>
        <TerminalSessionReadContext.Provider value={readContext}>
          <BranchDetailToolbar
            repo={repo}
            detail={detail}
            detailId="detail"
            contentId="content"
            collapsed={false}
            focusMode={false}
            layout={DEFAULT_WORKSPACE_LAYOUT}
          />
        </TerminalSessionReadContext.Provider>
      </MainWindowNavigationProvider>,
    )
  })

  const tab = container.querySelector<HTMLButtonElement>('#detail-terminal-tab')
  if (!tab) throw new Error('missing terminal tab')
  return tab
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

function rendererBridgeWith(overrides: {
  create: NonNullable<ReturnType<RendererBridge['terminal']>['create']>
}): RendererBridge {
  return {
    getBootstrap: emptyRendererBridgeBootstrap,
    invokeRpc: async () => null,
    abortRpc: async () => false,
    onRpcEvent: () => () => {},
    pathForFile: () => '',
    shell: () => null,
    terminal: () => ({
      attach: async () => ({ ok: false as const, message: 'unhandled terminal attach' }),
      restart: async () => ({ ok: false as const, message: 'unhandled terminal restart' }),
      write: async () => true,
      resize: async () => true,
      takeover: async () => ({
        ok: true as const,
        sessionId: 'session-1',
        controller: { attachmentId: 'attachment_local', status: 'connected' as const },
        canonicalCols: 80,
        canonicalRows: 24,
      }),
      close: async () => true,
      create: overrides.create,
      pruneTerminals: async () => ({ pruned: 0, remaining: 0 }),
      listSessions: async () => [],
      getSessionSnapshot: async () => null,
      notifyBell: async () => true,
      sendTestNotification: async () => true,
      setBadge: () => {},
      onOutput: () => () => {},
      onTitle: () => () => {},
      onExit: () => () => {},
      onOwnership: () => () => {},
      onSessionsChanged: () => () => {},
    }),
  }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
