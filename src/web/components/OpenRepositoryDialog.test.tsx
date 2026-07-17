// @vitest-environment jsdom

import { act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { OpenRepositoryDialog } from '#/web/components/OpenRepositoryDialog.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import type { OpenRepoResult } from '#/web/stores/repos/types.ts'

let ipcCalls: Array<{ path: string; input?: unknown }> = []
const testWindow = window as unknown as {
  goblinNative?: unknown
  __GOBLIN_BOOTSTRAP__?: unknown
}

beforeEach(() => {
  ipcCalls = []
  setClientBridgeForTests(null)
  testWindow.__GOBLIN_BOOTSTRAP__ = {
    runtime: { kind: 'electron', bridgeVersion: 1, capabilities: [] },
    initialServer: null,
  }
  // Host info used to live in the bootstrap payload; it now lives
  // on the public `/api/host` endpoint and the client-side
  // `useHostInfoStore`. Seed the store directly so the dialog's
  // tilde resolution and platform branching work without
  // mocking `fetch`.
  useHostInfoStore.setState({
    snapshot: { homeDir: '/Users/tester', platform: 'darwin', hostname: 'test', pid: 1 },
    hydrated: true,
  })
  testWindow.goblinNative = {
    pathForFile: () => '',
    host: {
      openDirectoryDialog: async () => '/Users/tester/Developer/repo',
    },
    invokeIpc: async (request: { path: string; input?: unknown }) => {
      ipcCalls.push(request)
      return null
    },
    abortIpc: async () => true,
    onEvent: () => () => {},
  }
})

afterEach(() => {
  setClientBridgeForTests(null)
  delete testWindow.goblinNative
  delete testWindow.__GOBLIN_BOOTSTRAP__
})

describe('OpenRepositoryDialog', () => {
  test('keeps the inline status row mounted', () => {
    render(
      <OpenRepositoryDialog
        open
        onClose={vi.fn()}
        onOpen={vi.fn(async () => ({ ok: true as const, id: 'goblin+file:///Users/tester/Developer/repo' }))}
      />,
    )

    expect(document.body.querySelector('[data-slot="dialog-status-row"]')).not.toBeNull()
  })

  test('focuses the repository path input when opened', () => {
    render(
      <OpenRepositoryDialog
        open
        onClose={vi.fn()}
        onOpen={vi.fn(async () => ({ ok: true as const, id: 'goblin+file:///Users/tester/Developer/repo' }))}
      />,
    )

    expect(document.activeElement).toBe(input('#open-repo-path'))
  })

  test('does not echo the typed path into the inline status row during normal input', () => {
    render(
      <OpenRepositoryDialog
        open
        onClose={vi.fn()}
        onOpen={vi.fn(async () => ({ ok: true as const, id: 'goblin+file:///Users/tester/Developer/repo' }))}
      />,
    )

    setInputValue('#open-repo-path', '~/asdasdasd')

    const status = document.body.querySelector('[data-slot="dialog-status-text"]')
    expect(status?.textContent).toBe('')
    expect(document.body.textContent).not.toContain('~/asdasdasd~/asdasdasd')
  })

  test('waits for open success before closing', async () => {
    const deferred = createDeferred<OpenRepoResult>()
    const onClose = vi.fn()
    const onOpen = vi.fn(() => deferred.promise)

    render(<OpenRepositoryDialog open onClose={onClose} onOpen={onOpen} />)

    setInputValue('#open-repo-path', '~/Developer/repo')
    click('button[type="submit"]')

    expect(onOpen).toHaveBeenCalledWith('/Users/tester/Developer/repo')
    expect(onClose).not.toHaveBeenCalled()
    expect(buttonByText('dialog.cancel').disabled).toBe(true)
    expect(queryButtonByText('Close')).toBeNull()

    deferred.resolve({ ok: true, id: 'goblin+file:///Users/tester/Developer/repo' })
    await flush()

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('can fill the path from the native picker and keeps the dialog open on failure', async () => {
    const onClose = vi.fn()
    const onOpen = vi.fn(async (): Promise<OpenRepoResult> => ({
      ok: false,
      message: 'error.workspace-git-unavailable',
    }))

    render(<OpenRepositoryDialog open onClose={onClose} onOpen={onOpen} />)

    clickButtonByText('repo-picker.open-path-choose')
    await flush()
    expect(testWindow.goblinNative).toEqual(
      expect.objectContaining({
        host: expect.objectContaining({ openDirectoryDialog: expect.any(Function) }),
      }),
    )
    expect(input('#open-repo-path').value).toBe('~/Developer/repo')

    click('button[type="submit"]')
    await flush()

    expect(onClose).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('error.workspace-git-unavailable')
  })

  test('allows retry after an unexpected open error', async () => {
    const onClose = vi.fn()
    const onOpen = vi
      .fn<() => Promise<OpenRepoResult>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ ok: true, id: 'goblin+file:///Users/tester/Developer/repo' })

    render(<OpenRepositoryDialog open onClose={onClose} onOpen={onOpen} />)

    setInputValue('#open-repo-path', '~/Developer/repo')
    click('button[type="submit"]')
    await flush()

    expect(document.body.textContent).toContain('boom')
    expect(button('button[type="submit"]').disabled).toBe(false)

    click('button[type="submit"]')
    await flush()

    expect(onOpen).toHaveBeenNthCalledWith(1, '/Users/tester/Developer/repo')
    expect(onOpen).toHaveBeenNthCalledWith(2, '/Users/tester/Developer/repo')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('ignores an older submit result after the dialog is reopened', async () => {
    const first = createDeferred<OpenRepoResult>()
    const second = createDeferred<OpenRepoResult>()
    const onClose = vi.fn()
    const onOpen = vi.fn(() => (onOpen.mock.calls.length === 0 ? first.promise : second.promise))

    const { rerender } = render(<OpenRepositoryDialog open onClose={onClose} onOpen={onOpen} />)

    setInputValue('#open-repo-path', '~/Developer/repo')
    click('button[type="submit"]')

    rerender(<OpenRepositoryDialog open={false} onClose={onClose} onOpen={onOpen} />)
    rerender(<OpenRepositoryDialog open onClose={onClose} onOpen={onOpen} />)

    first.resolve({ ok: true, id: 'goblin+file:///Users/tester/Developer/repo' })
    await flush()

    expect(onClose).not.toHaveBeenCalled()
    expect(button('button[type="submit"]').disabled).toBe(true)

    setInputValue('#open-repo-path', '~/Developer/repo-next')
    click('button[type="submit"]')
    second.resolve({ ok: true, id: 'goblin+file:///Users/tester/Developer/repo-next' })
    await flush()

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('clears a previous inline error after editing the path', async () => {
    const onClose = vi.fn()
    const onOpen = vi.fn<() => Promise<OpenRepoResult>>().mockRejectedValueOnce(new Error('boom'))

    render(<OpenRepositoryDialog open onClose={onClose} onOpen={onOpen} />)

    setInputValue('#open-repo-path', '~/Developer/repo')
    click('button[type="submit"]')
    await flush()

    expect(document.body.textContent).toContain('boom')

    setInputValue('#open-repo-path', '~/Developer/repo-next')

    expect(document.body.textContent).not.toContain('boom')
  })

  test('hides native picker button when no Electron bridge exists', async () => {
    delete testWindow.goblinNative
    setClientBridgeForTests(null)
    const onClose = vi.fn()
    const onOpen = vi.fn(async (): Promise<OpenRepoResult> => ({
      ok: true,
      id: 'goblin+file:///Users/tester/Developer/repo',
    }))

    render(<OpenRepositoryDialog open onClose={onClose} onOpen={onOpen} />)

    expect(queryButtonByText('repo-picker.open-path-choose')).toBeNull()
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

function clickButtonByText(text: string) {
  const element = buttonByText(text)
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
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
