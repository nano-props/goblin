// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useMenuActions } from '#/renderer/hooks/useMenuActions.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { createBranchSnapshot, resetReposStore, seedRepoState } from '#/renderer/stores/repos/test-utils.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const rpcEventListeners = new Set<(event: { type: string; repoRoot?: string }) => void>()
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const closeAllOverlays = vi.fn()
let overlayOpen = false

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  closeAllOverlays.mockClear()
  overlayOpen = false
  Object.defineProperty(window, 'goblin', {
    configurable: true,
    value: {
      homeDir: '/Users/test',
      invokeRpc: vi.fn(async () => null),
      abortRpc: vi.fn(async () => true),
      onEvent: vi.fn((cb: (event: { type: string; repoRoot?: string }) => void) => {
        rpcEventListeners.add(cb)
        return () => {
          rpcEventListeners.delete(cb)
        }
      }),
      pathForFile: vi.fn(() => ''),
      terminal: {
        open: vi.fn(),
        restart: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        close: vi.fn(),
        pruneRepo: vi.fn(),
        notifyBell: vi.fn(),
        sendTestNotification: vi.fn(),
        setBadge: vi.fn(),
        onOutput: vi.fn(() => () => {}),
        onExit: vi.fn(() => () => {}),
      },
    },
  })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  rpcEventListeners.clear()
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('useMenuActions', () => {
  test('terminal bell clicks close all overlays and focus the repo terminal tab', async () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      currentBranch: 'main',
      selectedBranch: 'main',
      detailTab: 'status',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-worktree' } })],
    })

    await renderHookHost()

    expect(rpcEventListeners.size).toBeGreaterThan(0)
    await act(async () => {
      for (const listener of rpcEventListeners) listener({ type: 'terminal-bell-click', repoRoot: repo.id })
      await Promise.resolve()
    })

    expect(closeAllOverlays).toHaveBeenCalledTimes(1)
    const state = useReposStore.getState()
    expect(state.activeId).toBe(repo.id)
    expect(state.repos[repo.id]?.ui.detailTab).toBe('terminal')
    expect(state.detailCollapsed).toBe(false)
  })
})

async function renderHookHost() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <HookHost />,
    )
    await Promise.resolve()
  })
}

function HookHost() {
  useMenuActions({
    closeAllOverlays,
    openRepoPathDialog: () => {},
    openCloneRepo: () => {},
    openRemoteRepo: () => {},
    isOverlayOpen: () => overlayOpen,
  })
  return null
}
