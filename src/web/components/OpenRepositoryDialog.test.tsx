// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { OpenRepositoryDialog } from '#/web/components/OpenRepositoryDialog.tsx'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'
import type { OpenRepoResult } from '#/web/stores/repos/types.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
let rpcCalls: Array<{ path: string; input?: unknown }> = []
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const testWindow = window as unknown as { goblinNative?: unknown }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  rpcCalls = []
  setRendererBridgeForTests(null)
  testWindow.goblinNative = {
    homeDir: '/Users/tester',
    pathForFile: () => '',
    shell: {
      openDirectoryDialog: async () => '/Users/tester/Developer/repo',
    },
    invokeRpc: async (request: { path: string; input?: unknown }) => {
      rpcCalls.push(request)
      return null
    },
    abortRpc: async () => true,
    onEvent: () => () => {},
  }
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  delete testWindow.goblinNative
  setRendererBridgeForTests(null)
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('OpenRepositoryDialog', () => {
  test('keeps the inline status row mounted', () => {
    render(
      <OpenRepositoryDialog
        open
        onClose={vi.fn()}
        onOpen={vi.fn(async () => ({ ok: true as const, id: '/Users/tester/Developer/repo' }))}
      />,
    )

    expect(document.body.querySelector('[data-slot="dialog-status-row"]')).not.toBeNull()
  })

  test('focuses the repository path input when opened', () => {
    render(
      <OpenRepositoryDialog
        open
        onClose={vi.fn()}
        onOpen={vi.fn(async () => ({ ok: true as const, id: '/Users/tester/Developer/repo' }))}
      />,
    )

    expect(document.activeElement).toBe(input('#open-repo-path'))
  })

  test('does not echo the typed path into the inline status row during normal input', () => {
    render(
      <OpenRepositoryDialog
        open
        onClose={vi.fn()}
        onOpen={vi.fn(async () => ({ ok: true as const, id: '/Users/tester/Developer/repo' }))}
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

    deferred.resolve({ ok: true, id: '/Users/tester/Developer/repo' })
    await flush()

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('can fill the path from the native picker and keeps the dialog open on failure', async () => {
    const onClose = vi.fn()
    const onOpen = vi.fn(async (): Promise<OpenRepoResult> => ({ ok: false, message: 'error.not-git-repo' }))

    render(<OpenRepositoryDialog open onClose={onClose} onOpen={onOpen} />)

    clickButtonByText('repo-tabs.open-path-choose')
    await flush()
    expect(testWindow.goblinNative).toEqual(
      expect.objectContaining({
        shell: expect.objectContaining({ openDirectoryDialog: expect.any(Function) }),
      }),
    )
    expect(input('#open-repo-path').value).toBe('~/Developer/repo')

    click('button[type="submit"]')
    await flush()

    expect(onClose).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('error.not-git-repo')
  })

  test('allows retry after an unexpected open error', async () => {
    const onClose = vi.fn()
    const onOpen = vi
      .fn<() => Promise<OpenRepoResult>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ ok: true, id: '/Users/tester/Developer/repo' })

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
    setRendererBridgeForTests(null)
    const onClose = vi.fn()
    const onOpen = vi.fn(async (): Promise<OpenRepoResult> => ({ ok: true, id: '/Users/tester/Developer/repo' }))

    render(<OpenRepositoryDialog open onClose={onClose} onOpen={onOpen} />)

    expect(queryButtonByText('repo-tabs.open-path-choose')).toBeNull()
  })
})

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
