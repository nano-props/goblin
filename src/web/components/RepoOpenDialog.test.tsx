// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoOpenDialog } from '#/web/components/RepoOpenDialog.tsx'
import {
  PrimaryWindowNavigationProvider,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore } from '#/web/test-utils/bridge.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

const testWindow = window as unknown as {
  goblinNative?: unknown
  __GOBLIN_BOOTSTRAP__?: unknown
}

beforeEach(() => {
  resetReposStore()
  setClientBridgeForTests(null)
  // The bootstrap is the source of truth for the tiny client
  // payload (runtime kind, initial server handoff). The preload
  // only exposes IPC. Host info (homeDir, platform) used to live
  // in the bootstrap; it now lives on the public `/api/host`
  // endpoint and the client-side `useHostInfoStore` — seed
  // that store directly so the dialog's tilde resolution and
  // platform branching work without mocking `fetch`.
  Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', {
    configurable: true,
    value: {
      runtime: { kind: 'electron', bridgeVersion: 1, capabilities: [] },
      initialServer: null,
    },
  })
  Object.defineProperty(window, 'goblinNative', {
    configurable: true,
    value: {
      pathForFile: () => '',
      invokeIpc: async (_request: { path: string; input?: unknown }) => null,
      abortIpc: async () => true,
      onEvent: () => () => {},
    },
  })
  useHostInfoStore.setState({
    snapshot: { homeDir: '/Users/tester', platform: 'darwin', hostname: 'test', pid: 1 },
    hydrated: true,
  })
})

afterEach(() => {
  delete testWindow.goblinNative
  delete testWindow.__GOBLIN_BOOTSTRAP__
  setClientBridgeForTests(null)
})

describe('RepoOpenDialog', () => {
  test('ensures the workspace is open before delegating activation to navigation', async () => {
    const ensureWorkspaceOpen = vi.fn(async () => ({ ok: true as const, id: '/Users/tester/Developer/repo' }))
    useReposStore.setState({ ensureWorkspaceOpen })
    const activateRepo = vi.fn()
    const onOpenChange = vi.fn()

    renderInJsdom(
      <PrimaryWindowNavigationProvider value={navigationWith({ activateRepo })}>
        <RepoOpenDialog open onOpenChange={onOpenChange} />
      </PrimaryWindowNavigationProvider>,
    )

    setInputValue('#open-repo-path', '~/Developer/repo')
    click('button[type="submit"]')
    await flush()

    expect(ensureWorkspaceOpen).toHaveBeenCalledWith('/Users/tester/Developer/repo')
    expect(activateRepo).toHaveBeenCalledWith('/Users/tester/Developer/repo')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

function navigationWith(overrides: Partial<PrimaryWindowNavigationActions>): PrimaryWindowNavigationActions {
  return {
    activateRepo: () => {},
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoBranchWorkspacePaneTab: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
  }
}

function input(selector: string): HTMLInputElement {
  const element = document.body.querySelector(selector)
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input: ${selector}`)
  return element
}

function button(selector: string): HTMLButtonElement {
  const element = document.body.querySelector(selector)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button: ${selector}`)
  return element
}

function setInputValue(selector: string, value: string) {
  const element = input(selector)
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(element, value)
  act(() => {
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function click(selector: string) {
  const element = button(selector)
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
