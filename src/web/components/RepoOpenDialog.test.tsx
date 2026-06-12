// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoOpenDialog } from '#/web/components/RepoOpenDialog.tsx'
import { MainWindowNavigationProvider, type MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore } from '#/web/stores/repos/test-utils.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const testWindow = window as unknown as { goblinNative?: unknown }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  setRendererBridgeForTests(null)
  Object.defineProperty(window, 'goblinNative', {
    configurable: true,
    value: {
      homeDir: '/Users/tester',
      pathForFile: () => '',
      invokeIpc: async (_request: { path: string; input?: unknown }) => null,
      abortIpc: async () => true,
      onEvent: () => () => {},
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
  delete testWindow.goblinNative
  setRendererBridgeForTests(null)
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('RepoOpenDialog', () => {
  test('ensures the workspace is open before delegating activation to navigation', async () => {
    const ensureWorkspaceOpen = vi.fn(async () => ({ ok: true as const, id: '/Users/tester/Developer/repo' }))
    useReposStore.setState({ ensureWorkspaceOpen })
    const activateRepo = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <MainWindowNavigationProvider value={navigationWith({ activateRepo })}>
        <RepoOpenDialog open onOpenChange={onOpenChange} />
      </MainWindowNavigationProvider>,
    )

    setInputValue('#open-repo-path', '~/Developer/repo')
    click('button[type="submit"]')
    await flush()

    expect(ensureWorkspaceOpen).toHaveBeenCalledWith('/Users/tester/Developer/repo')
    expect(activateRepo).toHaveBeenCalledWith('/Users/tester/Developer/repo')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

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

function render(element: ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
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
