// @vitest-environment jsdom
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

import { act } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { OpenWorkspaceDialog } from '#/web/components/OpenWorkspaceDialog.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import type { OpenWorkspaceResult } from '#/web/stores/workspaces/types.ts'
import { currentNativeBridge } from '#/web/test-utils/current-native-bridge.ts'
import { CLIENT_BRIDGE_VERSION, ELECTRON_CLIENT_CAPABILITIES } from '#/shared/bootstrap.ts'

const mocks = vi.hoisted(() => ({
  getLocalDirectoryPathSuggestions: vi.fn(),
}))

vi.mock('#/web/workspace-client.ts', () => ({
  getLocalDirectoryPathSuggestions: mocks.getLocalDirectoryPathSuggestions,
}))

let ipcCalls: Array<{ path: string; input?: unknown }> = []
const testWindow = window as unknown as {
  goblinNative?: unknown
  __GOBLIN_BOOTSTRAP__?: unknown
}

beforeEach(() => {
  ipcCalls = []
  mocks.getLocalDirectoryPathSuggestions.mockReset()
  mocks.getLocalDirectoryPathSuggestions.mockResolvedValue([])
  setClientBridgeForTests(null)
  testWindow.__GOBLIN_BOOTSTRAP__ = {
    runtime: {
      kind: 'electron',
      bridgeVersion: CLIENT_BRIDGE_VERSION,
      capabilities: ELECTRON_CLIENT_CAPABILITIES,
    },
    initialServer: null,
  }
  // Host info used to live in the bootstrap payload; it now lives
  // on the public `/api/host` endpoint and the client-side
  // `useHostInfoStore`. Seed the store directly so the dialog's
  // tilde resolution and platform branching work without
  // mocking `fetch`.
  useHostInfoStore.setState({
    snapshot: { homeDir: '/Users/tester', platform: 'darwin', hostname: 'test', pid: 1 },
    status: 'ready',
    error: null,
  })
  testWindow.goblinNative = currentNativeBridge({
    host: {
      openSettingsWindow: async () => true,
      openExternalUrl: async ({ url }) => ({ ok: true, message: url }),
      openDirectoryDialog: async () => '/Users/tester/Developer/repo',
      consumeExternalOpenPaths: async () => [],
    },
    invokeIpc: async (request: { path: string; input?: unknown }) => {
      ipcCalls.push(request)
      return null
    },
  })
})

afterEach(() => {
  setClientBridgeForTests(null)
  delete testWindow.goblinNative
  delete testWindow.__GOBLIN_BOOTSTRAP__
})

describe('OpenWorkspaceDialog', () => {
  test('shows local directory suggestions while preserving the picker layout wrapper', async () => {
    mocks.getLocalDirectoryPathSuggestions.mockResolvedValue(['/Users/tester/Developer'])
    render(
      <OpenWorkspaceDialog
        open
        onClose={vi.fn()}
        onOpen={vi.fn(async () => ({
          ok: true as const,
          workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer'),
        }))}
      />,
    )

    await setInputValue('#open-workspace-path', '/Users/tester/Dev')
    await vi.waitFor(() =>
      expect(document.body.querySelector('[role="option"]')?.textContent).toContain('/Users/tester/Developer'),
    )

    expect(input('#open-workspace-path').parentElement?.className).toContain('min-w-0')
    expect(mocks.getLocalDirectoryPathSuggestions).toHaveBeenCalledWith('/Users/tester/Dev', expect.any(AbortSignal))
  })

  test('lets the popup own the first Escape before the dialog owns the second', async () => {
    const onClose = vi.fn()
    mocks.getLocalDirectoryPathSuggestions.mockResolvedValue(['/Users/tester/Developer'])
    render(
      <OpenWorkspaceDialog
        open
        onClose={onClose}
        onOpen={vi.fn(async () => ({
          ok: true as const,
          workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer'),
        }))}
      />,
    )
    await setInputValue('#open-workspace-path', '/Users/tester/Dev')
    await vi.waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull())
    const user = userEvent.setup()
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()

    await user.keyboard('{Escape}')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('keeps the inline status row mounted', () => {
    render(
      <OpenWorkspaceDialog
        open
        onClose={vi.fn()}
        onOpen={vi.fn(async () => ({
          ok: true as const,
          workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo'),
        }))}
      />,
    )

    expect(document.body.querySelector('[data-slot="dialog-status-row"]')).not.toBeNull()
  })

  test('focuses the workspace path input when opened', () => {
    render(
      <OpenWorkspaceDialog
        open
        onClose={vi.fn()}
        onOpen={vi.fn(async () => ({
          ok: true as const,
          workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo'),
        }))}
      />,
    )

    expect(document.activeElement).toBe(input('#open-workspace-path'))
  })

  test('does not echo the typed path into the inline status row during normal input', async () => {
    render(
      <OpenWorkspaceDialog
        open
        onClose={vi.fn()}
        onOpen={vi.fn(async () => ({
          ok: true as const,
          workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo'),
        }))}
      />,
    )

    await setInputValue('#open-workspace-path', '~/asdasdasd')

    const status = document.body.querySelector('[data-slot="dialog-status-text"]')
    expect(status?.textContent).toBe('')
    expect(document.body.textContent).not.toContain('~/asdasdasd~/asdasdasd')
  })

  test('waits for open success before closing', async () => {
    const deferred = createDeferred<OpenWorkspaceResult>()
    const onClose = vi.fn()
    const onOpen = vi.fn(() => deferred.promise)

    render(<OpenWorkspaceDialog open onClose={onClose} onOpen={onOpen} />)

    await setInputValue('#open-workspace-path', '~/Developer/repo')
    await click('button[type="submit"]')

    expect(onOpen).toHaveBeenCalledWith('/Users/tester/Developer/repo')
    expect(onClose).not.toHaveBeenCalled()
    expect(buttonByText('dialog.cancel').disabled).toBe(true)
    expect(queryButtonByText('Close')).toBeNull()

    deferred.resolve({ ok: true, workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo') })
    await flush()

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('can fill the path from the native picker and keeps the dialog open on failure', async () => {
    const onClose = vi.fn()
    const onOpen = vi.fn(async (): Promise<OpenWorkspaceResult> => ({
      ok: false,
      message: 'error.workspace-git-unavailable',
    }))

    render(<OpenWorkspaceDialog open onClose={onClose} onOpen={onOpen} />)

    await clickButtonByText('workspace-picker.open-path-choose')
    await flush()
    expect(testWindow.goblinNative).toEqual(
      expect.objectContaining({
        host: expect.objectContaining({ openDirectoryDialog: expect.any(Function) }),
      }),
    )
    expect(input('#open-workspace-path').value).toBe('~/Developer/repo')

    await click('button[type="submit"]')
    await flush()

    expect(onClose).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('error.workspace-git-unavailable')
  })

  test('allows retry after an unexpected open error', async () => {
    const onClose = vi.fn()
    const onOpen = vi
      .fn<() => Promise<OpenWorkspaceResult>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        ok: true,
        workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo'),
      })

    render(<OpenWorkspaceDialog open onClose={onClose} onOpen={onOpen} />)

    await setInputValue('#open-workspace-path', '~/Developer/repo')
    await click('button[type="submit"]')
    await flush()

    expect(document.body.textContent).toContain('boom')
    expect(button('button[type="submit"]').disabled).toBe(false)

    await click('button[type="submit"]')
    await flush()

    expect(onOpen).toHaveBeenNthCalledWith(1, '/Users/tester/Developer/repo')
    expect(onOpen).toHaveBeenNthCalledWith(2, '/Users/tester/Developer/repo')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('ignores an older submit result after the dialog is reopened', async () => {
    const first = createDeferred<OpenWorkspaceResult>()
    const second = createDeferred<OpenWorkspaceResult>()
    const onClose = vi.fn()
    const onOpen = vi.fn(() => (onOpen.mock.calls.length === 0 ? first.promise : second.promise))

    const { rerender } = render(<OpenWorkspaceDialog open onClose={onClose} onOpen={onOpen} />)

    await setInputValue('#open-workspace-path', '~/Developer/repo')
    await click('button[type="submit"]')

    rerender(<OpenWorkspaceDialog open={false} onClose={onClose} onOpen={onOpen} />)
    rerender(<OpenWorkspaceDialog open onClose={onClose} onOpen={onOpen} />)

    first.resolve({ ok: true, workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo') })
    await flush()

    expect(onClose).not.toHaveBeenCalled()
    expect(button('button[type="submit"]').disabled).toBe(true)

    await setInputValue('#open-workspace-path', '~/Developer/repo-next')
    await click('button[type="submit"]')
    second.resolve({ ok: true, workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo-next') })
    await flush()

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('clears a previous inline error after editing the path', async () => {
    const onClose = vi.fn()
    const onOpen = vi.fn<() => Promise<OpenWorkspaceResult>>().mockRejectedValueOnce(new Error('boom'))

    render(<OpenWorkspaceDialog open onClose={onClose} onOpen={onOpen} />)

    await setInputValue('#open-workspace-path', '~/Developer/repo')
    await click('button[type="submit"]')
    await flush()

    expect(document.body.textContent).toContain('boom')

    await setInputValue('#open-workspace-path', '~/Developer/repo-next')

    expect(document.body.textContent).not.toContain('boom')
  })

  test('hides native picker button when no Electron bridge exists', async () => {
    delete testWindow.goblinNative
    setClientBridgeForTests(null)
    const onClose = vi.fn()
    const onOpen = vi.fn(async (): Promise<OpenWorkspaceResult> => ({
      ok: true,
      workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo'),
    }))

    render(<OpenWorkspaceDialog open onClose={onClose} onOpen={onOpen} />)

    expect(queryButtonByText('workspace-picker.open-path-choose')).toBeNull()
  })
})

function render(element: ReactNode) {
  return renderInJsdom(element)
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

function queryButtonByText(text: string): HTMLButtonElement | null {
  const element = [...document.body.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === text,
  )
  return element instanceof HTMLButtonElement ? element : null
}

function buttonByText(text: string): HTMLButtonElement {
  const element = queryButtonByText(text)
  if (!element) throw new Error(`Missing button text: ${text}`)
  return element
}

async function setInputValue(selector: string, value: string) {
  const user = setupUser()
  await user.clear(input(selector))
  await user.type(input(selector), value)
}

async function click(selector: string) {
  await setupUser().click(button(selector))
}

async function clickButtonByText(text: string) {
  await setupUser().click(buttonByText(text))
}

function setupUser() {
  return userEvent.setup()
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
