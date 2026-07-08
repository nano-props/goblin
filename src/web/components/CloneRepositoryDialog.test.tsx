// @vitest-environment jsdom
import { act } from '@testing-library/react'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  CloneRepositoryDialog,
  type CloneRepositoryRequest,
} from '#/web/components/CloneRepositoryDialog.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import type { CloneRepoResult } from '#/shared/api-types.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

const testWindow = window as unknown as { goblinNative?: unknown; __GOBLIN_BOOTSTRAP__?: unknown }

beforeEach(() => {
  setClientBridgeForTests(null)
  testWindow.__GOBLIN_BOOTSTRAP__ = {
    runtime: {
      kind: 'electron',
      bridgeVersion: CLIENT_BRIDGE_VERSION,
      capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
    },
    initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
  }
  // Host info used to live in the bootstrap payload; it now
  // lives on the public `/api/host` endpoint and the client-side
  // `useHostInfoStore`. Seed the store directly so the dialog's
  // default parent dir (`~/Developer`) resolves correctly without
  // mocking `fetch('/api/host')`.
  useHostInfoStore.setState({
    snapshot: { homeDir: '/Users/tester', platform: 'darwin', hostname: 'test', pid: 1 },
    hydrated: true,
  })
  // Use `defineProperty` with `writable: true` so a previous test that
  // installed a read-only descriptor (via `defineProperty` without writable)
  // doesn't leave this assignment throwing `Cannot assign to read only
  // property 'goblinNative'`. All such property writes should opt into the
  // same shape so cross-test isolation stays predictable.
  Object.defineProperty(window, 'goblinNative', {
    configurable: true,
    writable: true,
    value: {
      runtime: {
        kind: 'electron',
        bridgeVersion: CLIENT_BRIDGE_VERSION,
        capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
      },
      pathForFile: () => '',
      invokeIpc: async () => null,
      abortIpc: async () => true,
      onEvent: () => () => {},
    },
  })
})

afterEach(() => {
  delete testWindow.goblinNative
  delete testWindow.__GOBLIN_BOOTSTRAP__
  setClientBridgeForTests(null)
})

describe('CloneRepositoryDialog', () => {
  test('keeps the inline status row mounted', () => {
    renderInJsdom(
      <CloneRepositoryDialog
        open
        onClose={vi.fn()}
        onClone={vi.fn(async () => ({ ok: true, message: 'ok', path: '/Users/tester/Developer/repo' }))}
      />,
    )

    expect(document.body.querySelector('[data-slot="dialog-status-row"]')).not.toBeNull()
  })

  test('focuses the clone url input when opened', () => {
    renderInJsdom(
      <CloneRepositoryDialog
        open
        onClose={vi.fn()}
        onClone={vi.fn(async () => ({ ok: true, message: 'ok', path: '/Users/tester/Developer/repo' }))}
      />,
    )

    expect(document.activeElement).toBe(input('#clone-url'))
  })

  test('waits for clone success before closing and hides the close button while pending', async () => {
    const deferred = createDeferred<CloneRepoResult>()
    const onClose = vi.fn()
    const onClone = vi.fn((_request: CloneRepositoryRequest) => deferred.promise)

    renderInJsdom(<CloneRepositoryDialog open onClose={onClose} onClone={onClone} />)

    setInputValue('#clone-url', 'https://example.com/repo.git')
    setInputValue('#clone-directory-name', 'repo')
    click('button[type="submit"]')

    expect(onClone).toHaveBeenCalledWith({
      url: 'https://example.com/repo.git',
      parentPath: '/Users/tester/Developer',
      directoryName: 'repo',
      signal: expect.any(AbortSignal),
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(buttonByText('dialog.cancel').disabled).toBe(false)
    expect(queryButtonByText('Close')).toBeNull()

    deferred.resolve({ ok: true, message: 'ok', path: '/Users/tester/Developer/repo' })
    await flush()

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('keeps the dialog open on clone failure and preserves user input', async () => {
    const onClose = vi.fn()
    const onClone = vi.fn(async () => ({ ok: false, message: 'error.clone-failed' }))

    renderInJsdom(<CloneRepositoryDialog open onClose={onClose} onClone={onClone} />)

    setInputValue('#clone-url', 'https://example.com/repo.git')
    setInputValue('#clone-directory-name', 'repo')
    click('button[type="submit"]')
    await flush()

    expect(onClose).not.toHaveBeenCalled()
    expect(input('#clone-url').value).toBe('https://example.com/repo.git')
    expect(input('#clone-directory-name').value).toBe('repo')
    expect(document.body.textContent).toContain('error.clone-failed')
  })

  test('cancel aborts an in-flight clone and closes the dialog', async () => {
    const deferred = createDeferred<CloneRepoResult>()
    const onClose = vi.fn()
    const onClone = vi.fn((_request: CloneRepositoryRequest) => deferred.promise)

    renderInJsdom(<CloneRepositoryDialog open onClose={onClose} onClone={onClone} />)

    setInputValue('#clone-url', 'https://example.com/repo.git')
    setInputValue('#clone-directory-name', 'repo')
    click('button[type="submit"]')
    const request = onClone.mock.calls[0]?.[0]
    clickButtonByText('dialog.cancel')
    await flush()

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(request?.signal.aborted).toBe(true)

    deferred.resolve({ ok: true, message: 'ok', path: '/Users/tester/Developer/repo' })
    await flush()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('hides native parent picker button when no Electron bridge exists', async () => {
    delete testWindow.goblinNative
    setClientBridgeForTests(null)
    const onClose = vi.fn()
    const onClone = vi.fn(async () => ({ ok: true, message: 'ok', path: '/Users/tester/Developer/repo' }))

    renderInJsdom(<CloneRepositoryDialog open onClose={onClose} onClone={onClone} />)

    expect(queryButtonByText('repo-picker.clone-parent-choose')).toBeNull()
  })
})

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
