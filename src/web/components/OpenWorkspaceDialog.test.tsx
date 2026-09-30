// @vitest-environment jsdom
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { waitFor } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { userEvent } from '@testing-library/user-event'
import type { VNode } from 'vue'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { OpenWorkspaceDialog } from '#/web/components/OpenWorkspaceDialog.tsx'
import { setClientBridgeForTests } from '#/web/bridge/client.ts'
import { hostInfoStore } from '#/web/stores/host-info.ts'
import type { OpenWorkspaceResult } from '#/web/stores/workspaces/types.ts'

const mocks = vi.hoisted(() => ({
  getLocalDirectoryPathSuggestions: vi.fn(),
}))

vi.mock('#/web/workspaces/client.ts', () => ({
  getLocalDirectoryPathSuggestions: mocks.getLocalDirectoryPathSuggestions,
}))

const testWindow = window as unknown as {
  __GOBLIN_BOOTSTRAP__?: unknown
}

beforeEach(() => {
  mocks.getLocalDirectoryPathSuggestions.mockReset()
  mocks.getLocalDirectoryPathSuggestions.mockResolvedValue([])
  setClientBridgeForTests(null)
  testWindow.__GOBLIN_BOOTSTRAP__ = {
    initialServer: null,
  }
  // Host info used to live in the bootstrap payload; it now lives
  // on the public `/api/host` endpoint and the client-side
  // `hostInfoStore`. Seed the store directly so the dialog's
  // tilde resolution and platform branching work without
  // mocking `fetch`.
  hostInfoStore.setState({
    snapshot: { homeDir: '/Users/tester', platform: 'darwin', hostname: 'test', pid: 1 },
    status: 'ready',
    error: null,
  })
})

afterEach(() => {
  setClientBridgeForTests(null)
  delete testWindow.__GOBLIN_BOOTSTRAP__
})

describe('OpenWorkspaceDialog', () => {
  test('lets the popup own the first Escape before the dialog owns the second', async () => {
    const onClose = vi.fn()
    mocks.getLocalDirectoryPathSuggestions.mockResolvedValue(['/Users/tester/Developer'])
    await render(
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
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull())
    const user = userEvent.setup()
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()

    await user.keyboard('{Escape}')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('keeps the inline status row mounted', async () => {
    await render(
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

  test('focuses the workspace path input when opened', async () => {
    await render(
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
    await render(
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
    const deferred = Promise.withResolvers<OpenWorkspaceResult>()
    const onClose = vi.fn()
    const onOpen = vi.fn(() => deferred.promise)

    await render(<OpenWorkspaceDialog open onClose={onClose} onOpen={onOpen} />)

    await setInputValue('#open-workspace-path', '~/Developer/repo')
    await click('button[type="submit"]')

    expect(onOpen).toHaveBeenCalledWith('/Users/tester/Developer/repo', expect.any(AbortSignal))
    expect(onClose).not.toHaveBeenCalled()
    expect(buttonByText('dialog.cancel').disabled).toBe(true)
    expect(queryButtonByText('Close')).toBeNull()

    deferred.resolve({ ok: true, workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo') })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
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

    await render(<OpenWorkspaceDialog open onClose={onClose} onOpen={onOpen} />)

    await setInputValue('#open-workspace-path', '~/Developer/repo')
    await click('button[type="submit"]')
    await waitFor(() => {
      expect(document.body.textContent).toContain('boom')
      expect(button('button[type="submit"]').disabled).toBe(false)
    })

    await click('button[type="submit"]')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    expect(onOpen).toHaveBeenNthCalledWith(1, '/Users/tester/Developer/repo', expect.any(AbortSignal))
    expect(onOpen).toHaveBeenNthCalledWith(2, '/Users/tester/Developer/repo', expect.any(AbortSignal))
  })

  test('ignores an older submit result after the dialog is reopened', async () => {
    const first = Promise.withResolvers<OpenWorkspaceResult>()
    const second = Promise.withResolvers<OpenWorkspaceResult>()
    const onClose = vi.fn()
    const onOpen = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const { rerender } = await render(<OpenWorkspaceDialog open onClose={onClose} onOpen={onOpen} />)

    await setInputValue('#open-workspace-path', '~/Developer/repo')
    await click('button[type="submit"]')
    expect(onOpen).toHaveBeenCalledOnce()

    await rerender(<OpenWorkspaceDialog open={false} onClose={onClose} onOpen={onOpen} />)
    await rerender(<OpenWorkspaceDialog open onClose={onClose} onOpen={onOpen} />)

    await flushTestUpdates(async () => {
      first.resolve({ ok: true, workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo') })
      await first.promise
    })

    expect(onClose).not.toHaveBeenCalled()
    expect(button('button[type="submit"]').disabled).toBe(true)

    await setInputValue('#open-workspace-path', '~/Developer/repo-next')
    await click('button[type="submit"]')
    second.resolve({ ok: true, workspaceId: workspaceIdForTest('goblin+file:///Users/tester/Developer/repo-next') })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  test('clears a previous inline error after editing the path', async () => {
    const onClose = vi.fn()
    const onOpen = vi.fn<() => Promise<OpenWorkspaceResult>>().mockRejectedValueOnce(new Error('boom'))

    await render(<OpenWorkspaceDialog open onClose={onClose} onOpen={onOpen} />)

    await setInputValue('#open-workspace-path', '~/Developer/repo')
    await click('button[type="submit"]')
    await waitFor(() => expect(document.body.textContent).toContain('boom'))

    await setInputValue('#open-workspace-path', '~/Developer/repo-next')

    expect(document.body.textContent).not.toContain('boom')
  })
})

async function render(element: VNode) {
  const result = renderInJsdom(element)
  await flushTestUpdates(() => {})
  return result
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
