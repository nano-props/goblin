// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { mockFetch } from '#/test-utils/fetch-mock.ts'

// Regression test for the create-worktree dialog host. The original
// implementation mounted inside the per-repo action subtree and
// lost its form state every time the user navigated to Settings
// because that subtree unmounted. The fix moved the
// host to `Layout.PrimaryWindowOverlays` (outside `<Outlet />`), so the
// dialog survives settings ⇄ workspace navigation.
//
// The subtle regression this protects against is closing the dialog
// on its own false→true transition. The host should treat `open`
// as Radix dialog state, not as its mount condition.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { CreateWorktreeDialogHost } from '#/web/components/CreateWorktreeDialogHost.tsx'
import { settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { setRepoSnapshotQueryData } from '#/web/repo-data-query.ts'

const REPO_ID = '/tmp/gbl-create-host-test'
let serverSettingsSnapshot: ReturnType<typeof defaultSettingsSnapshot>
let testQueryClient: QueryClient

beforeEach(async () => {
  testQueryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  globalThis.localStorage?.clear()
  resetReposStore()
  setServerSettings(defaultSettingsSnapshot())
  const repo = seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('main', { isCurrent: true, ahead: 0, behind: 0 })],
  })
  setRepoSnapshotQueryData(
    repo.id,
    repo.instanceId,
    {
      current: repo.data.currentBranch,
      branches: repo.data.branches,
    },
    testQueryClient,
  )
  mockCreateWorktreeHostFetch(async () => previewResponse({ hasOperations: false, configHash: null }))
})

afterEach(async () => {
  await testQueryClient.cancelQueries()
  testQueryClient.clear()
  globalThis.localStorage?.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderHost(open: boolean, onOpenChange: (open: boolean) => void) {
  return renderInJsdom(hostElement(open, onOpenChange, REPO_ID))
}

function hostElement(open: boolean, onOpenChange: (open: boolean) => void, repoId: string | null) {
  return (
    <QueryClientProvider client={testQueryClient}>
      <CreateWorktreeDialogHost open={open} onOpenChange={onOpenChange} repoId={repoId} />
    </QueryClientProvider>
  )
}

describe('CreateWorktreeDialogHost', () => {
  test('regression: dialog stays open after the false→true transition', () => {
    // The bug: an earlier effect had `[repoId, onOpenChange, open]` in its
    // deps. When the user clicked the "create worktree" button, the
    // parent's `open` state flipped false→true, the host re-rendered,
    // and the effect fired (because `open` changed), calling
    // `onOpenChange(false)`. The dialog was unopenable from the UI.
    //
    // The fix keeps repo/session ownership outside the host and leaves `open`
    // to the Radix dialog state machine.
    // In the real flow the host is mounted in Layout with `open=false`
    // initially; the parent flips to `true` when the user clicks the
    // create-worktree button. This test reproduces that flow.
    const onOpenChange = vi.fn()

    // (1) Initial mount: open=false (the host always starts closed).
    const { rerender } = renderHost(false, onOpenChange)
    expect(onOpenChange).not.toHaveBeenCalled()

    // (2) The user clicks the create-worktree button. Parent flips `open` to
    // true. The host re-renders; only `open` changed, not `repoId`.
    // The guarded effect must NOT call `onOpenChange(false)` — pre-fix
    // it did so in the same render.
    rerender(hostElement(true, onOpenChange, REPO_ID))
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  test('does not close merely because it mounted open', () => {
    const onOpenChange = vi.fn()

    renderHost(true, onOpenChange)

    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  test('does not force-close when the repo payload changes', () => {
    const onOpenChange = vi.fn()
    const { rerender } = renderHost(true, onOpenChange)

    rerender(hostElement(true, onOpenChange, '/tmp/other-repo'))

    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  test('renders nothing when no active repo', () => {
    const { container } = renderInJsdom(<CreateWorktreeDialogHost open onOpenChange={vi.fn()} repoId={null} />)
    expect(container.textContent).toBe('')
  })

  test('forwards a config trust state from the create dialog checkbox', async () => {
    const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    setServerSettings(defaultSettingsSnapshot())
    const submitBranchAction = vi.spyOn(useReposStore.getState(), 'submitBranchAction').mockImplementation(() => {})
    const fetchMock = mockCreateWorktreeHostFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const body = JSON.parse(String(init?.body ?? '{}')) as { cwd?: string }
      if (url.pathname === '/api/repo/worktree-bootstrap-preview') {
        expect(body.cwd).toBe(REPO_ID)
        return new Response(
          JSON.stringify({
            ok: true,
            preview: {
              hasConfig: true,
              hasOperations: true,
              configHash,
              copyCount: 1,
              symlinkCount: 0,
              hardlinkCount: 0,
              excludeCount: 0,
              setup: { command: 'bun install' },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ ok: false, message: 'unexpected request' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    })

    renderHost(true, vi.fn())
    await flushReact()

    expect(countPreviewRequests(fetchMock)).toBe(1)
    expect(document.body.textContent).toContain('action.create-worktree-bootstrap-config-trusted')
    expect(submitBranchAction).not.toHaveBeenCalled()

    setInputValue('cwt-branch', 'feature/bootstrap')
    await clickLabel('action.create-worktree-bootstrap-config-trusted')
    await clickButton('action.create-worktree-confirm')
    await flushReact()

    expect(submitBranchAction).toHaveBeenCalledWith(
      REPO_ID,
      expect.objectContaining({
        kind: 'createWorktree',
        worktreeBootstrap: {
          kind: 'run',
          configHash,
          configTrusted: true,
        },
      }),
      expect.objectContaining({ refreshOnError: false }),
    )
    expect(countPreviewRequests(fetchMock)).toBe(1)
  })

  test('forwards a run-once bootstrap decision from the create dialog without checking trust', async () => {
    const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    setServerSettings(defaultSettingsSnapshot())
    const submitBranchAction = vi.spyOn(useReposStore.getState(), 'submitBranchAction').mockImplementation(() => {})
    const fetchMock = mockCreateWorktreeHostFetch(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          preview: {
            hasConfig: true,
            hasOperations: true,
            configHash,
            copyCount: 1,
            symlinkCount: 0,
            hardlinkCount: 0,
            excludeCount: 0,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    renderHost(true, vi.fn())
    await flushReact()
    setInputValue('cwt-branch', 'feature/run-once')
    await clickButton('action.create-worktree-confirm')
    await flushReact()

    expect(submitBranchAction).toHaveBeenCalledWith(
      REPO_ID,
      expect.objectContaining({
        kind: 'createWorktree',
        worktreeBootstrap: {
          kind: 'run',
          configHash,
          configTrusted: false,
        },
      }),
      expect.objectContaining({ refreshOnError: false }),
    )
    expect(countPreviewRequests(fetchMock)).toBe(1)
  })

  test('runs goblin.toml bootstrap once by default for untrusted configs', async () => {
    const submitBranchAction = vi.spyOn(useReposStore.getState(), 'submitBranchAction').mockImplementation(() => {})
    const fetchMock = mockCreateWorktreeHostFetch(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          preview: {
            hasConfig: true,
            hasOperations: true,
            configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            copyCount: 1,
            symlinkCount: 0,
            hardlinkCount: 0,
            excludeCount: 0,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    renderHost(true, vi.fn())
    await flushReact()
    setInputValue('cwt-branch', 'feature/skip-bootstrap')
    await clickButton('action.create-worktree-confirm')
    await flushReact()

    expect(submitBranchAction).toHaveBeenCalledWith(
      REPO_ID,
      expect.objectContaining({
        kind: 'createWorktree',
        worktreeBootstrap: {
          kind: 'run',
          configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          configTrusted: false,
        },
      }),
      expect.objectContaining({ refreshOnError: false }),
    )
    expect(countPreviewRequests(fetchMock)).toBe(1)
  })

  test('does not submit a bootstrap decision before settings trust state is loaded', async () => {
    const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    testQueryClient.removeQueries({ queryKey: settingsSnapshotQueryKey(), exact: true })
    const submitBranchAction = vi.spyOn(useReposStore.getState(), 'submitBranchAction').mockImplementation(() => {})
    mockCreateWorktreeHostFetch(async () => previewResponse({ hasOperations: true, configHash }), {
      settings: () => new Promise<Response>(() => {}),
    })

    renderHost(true, vi.fn())
    await flushReact()
    setInputValue('cwt-branch', 'feature/wait-for-settings')
    await clickButton('action.create-worktree-confirm')
    await flushReact()

    expect(submitBranchAction).not.toHaveBeenCalled()
  })

  test('preflights then auto-runs a trusted goblin.toml config hash while showing the trust checkbox', async () => {
    setServerSettings(
      defaultSettingsSnapshot({
        repoSettings: [
          {
            repoId: REPO_ID,
            worktreeBootstrapTrust: {
              configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              trustedAt: '2026-06-26T00:00:00.000Z',
            },
          },
        ],
      }),
    )
    const submitBranchAction = vi.spyOn(useReposStore.getState(), 'submitBranchAction').mockImplementation(() => {})
    const fetchMock = mockCreateWorktreeHostFetch(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { cwd?: string }
      expect(body.cwd).toBe(REPO_ID)
      return new Response(
        JSON.stringify({
          ok: true,
          preview: {
            hasConfig: true,
            hasOperations: true,
            configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            copyCount: 1,
            symlinkCount: 0,
            hardlinkCount: 0,
            excludeCount: 0,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    renderHost(true, vi.fn())
    await flushReact()
    setInputValue('cwt-branch', 'feature/trusted')
    await clickButton('action.create-worktree-confirm')
    await flushReact()

    expect(countPreviewRequests(fetchMock)).toBe(1)
    expect(document.body.textContent).toContain('action.create-worktree-bootstrap-config-trusted')
    const trustCheckbox = checkboxForLabel('action.create-worktree-bootstrap-config-trusted')
    expect(trustCheckbox.getAttribute('aria-checked')).toBe('true')
    expect(trustCheckbox.hasAttribute('disabled')).toBe(false)
    expect(submitBranchAction).toHaveBeenCalledWith(
      REPO_ID,
      expect.objectContaining({
        kind: 'createWorktree',
        worktreeBootstrap: {
          kind: 'run',
          configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          configTrusted: true,
        },
      }),
      expect.objectContaining({ refreshOnError: false }),
    )
  })

  test('forwards an unchecked trust choice for an already trusted goblin.toml config hash', async () => {
    const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    setServerSettings(
      defaultSettingsSnapshot({
        repoSettings: [
          {
            repoId: REPO_ID,
            worktreeBootstrapTrust: {
              configHash,
              trustedAt: '2026-06-26T00:00:00.000Z',
            },
          },
        ],
      }),
    )
    const submitBranchAction = vi.spyOn(useReposStore.getState(), 'submitBranchAction').mockImplementation(() => {})
    mockCreateWorktreeHostFetch(async () => previewResponse({ hasOperations: true, configHash }))

    renderHost(true, vi.fn())
    await flushReact()

    const trustCheckbox = checkboxForLabel('action.create-worktree-bootstrap-config-trusted')
    expect(trustCheckbox.getAttribute('aria-checked')).toBe('true')
    await clickLabel('action.create-worktree-bootstrap-config-trusted')
    expect(trustCheckbox.getAttribute('aria-checked')).toBe('false')

    setInputValue('cwt-branch', 'feature/untrust')
    await clickButton('action.create-worktree-confirm')
    await flushReact()

    expect(submitBranchAction).toHaveBeenCalledWith(
      REPO_ID,
      expect.objectContaining({
        kind: 'createWorktree',
        worktreeBootstrap: { kind: 'run', configHash, configTrusted: false },
      }),
      expect.objectContaining({ refreshOnError: false }),
    )
  })

  test('shows preview errors and skips bootstrap when creating anyway', async () => {
    setServerSettings(defaultSettingsSnapshot())
    const submitBranchAction = vi.spyOn(useReposStore.getState(), 'submitBranchAction').mockImplementation(() => {})
    mockCreateWorktreeHostFetch(async () => {
      return new Response(JSON.stringify({ ok: false, message: 'invalid goblin.toml' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    renderHost(true, vi.fn())
    await flushReact()

    expect(document.body.textContent).not.toContain('action.create-worktree-bootstrap-error')
    expect(document.body.textContent).not.toContain('action.create-worktree-bootstrap-config-trusted')
    expect(document.body.textContent).not.toContain('action.create-worktree-bootstrap-run')

    setInputValue('cwt-branch', 'feature/preview-error')
    await clickButton('action.create-worktree-confirm')
    await flushReact()

    expect(submitBranchAction).toHaveBeenCalledWith(
      REPO_ID,
      expect.objectContaining({
        kind: 'createWorktree',
        worktreeBootstrap: { kind: 'skip' },
      }),
      expect.objectContaining({ refreshOnError: false }),
    )
  })

  test('ignores a stale bootstrap preview after reopening the create dialog', async () => {
    const configHash = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    setServerSettings(
      defaultSettingsSnapshot({
        repoSettings: [
          {
            repoId: REPO_ID,
            worktreeBootstrapTrust: {
              configHash,
              trustedAt: '2026-06-26T00:00:00.000Z',
            },
          },
        ],
      }),
    )
    const submitBranchAction = vi.spyOn(useReposStore.getState(), 'submitBranchAction').mockImplementation(() => {})
    const firstPreview = deferred<Response>()
    const secondPreview = deferred<Response>()
    const previewResponses = [firstPreview, secondPreview]
    mockCreateWorktreeHostFetch((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname !== '/api/repo/worktree-bootstrap-preview') {
        throw new Error(`unexpected request ${url.pathname}`)
      }
      const next = previewResponses.shift()
      if (!next) throw new Error('unexpected preview request')
      return next.promise
    })

    const { rerender } = renderHost(true, vi.fn())
    await flushReact()
    rerender(hostElement(false, vi.fn(), REPO_ID))
    rerender(hostElement(true, vi.fn(), REPO_ID))
    await flushReact()

    secondPreview.resolve(previewResponse({ hasOperations: true, configHash }))
    await flushReact()
    firstPreview.resolve(previewResponse({ hasOperations: false, configHash: null }))
    await flushReact()

    setInputValue('cwt-branch', 'feature/new')
    await clickButton('action.create-worktree-confirm')
    await flushReact()

    expect(submitBranchAction).toHaveBeenCalledTimes(1)
    expect(submitBranchAction).toHaveBeenCalledWith(
      REPO_ID,
      expect.objectContaining({
        kind: 'createWorktree',
        input: expect.objectContaining({
          mode: expect.objectContaining({ newBranch: 'feature/new' }),
        }),
        worktreeBootstrap: { kind: 'run', configHash, configTrusted: true },
      }),
      expect.objectContaining({ refreshOnError: false }),
    )
  })
})

function setServerSettings(snapshot: ReturnType<typeof defaultSettingsSnapshot>): void {
  serverSettingsSnapshot = snapshot
  testQueryClient.setQueryData(settingsSnapshotQueryKey(), snapshot)
}

function mockCreateWorktreeHostFetch(
  preview: (...args: Parameters<typeof fetch>) => Response | unknown,
  options: { settings?: (...args: Parameters<typeof fetch>) => Response | unknown } = {},
) {
  return mockFetch((...args: Parameters<typeof fetch>) => {
    const [input] = args
    const pathname = new URL(String(input), 'http://localhost').pathname
    if (pathname === '/api/settings') {
      return options.settings
        ? options.settings(...args)
        : new Response(JSON.stringify(serverSettingsSnapshot), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
    }
    if (pathname === '/api/repo/worktree-bootstrap-preview') return preview(...args)
    throw new Error(`unexpected request ${pathname}`)
  })
}

function countPreviewRequests(fetchMock: ReturnType<typeof mockFetch>): number {
  return fetchMock.mock.calls.filter(([input]) => {
    return new URL(String(input), 'http://localhost').pathname === '/api/repo/worktree-bootstrap-preview'
  }).length
}

function previewResponse(input: { hasOperations: boolean; configHash: string | null }): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      preview: {
        hasConfig: input.configHash !== null,
        hasOperations: input.hasOperations,
        configHash: input.configHash,
        copyCount: 0,
        symlinkCount: 0,
        hardlinkCount: 0,
        excludeCount: 0,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushReact(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function setInputValue(id: string, value: string): void {
  const input = document.body.querySelector(`#${id}`)
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing input ${id}`)
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!valueSetter) throw new Error('missing input value setter')
  act(() => {
    valueSetter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function clickButton(text: string): Promise<void> {
  const button = Array.from(document.body.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === text,
  )
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button ${text}`)
  await act(async () => {
    button.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function clickLabel(text: string): Promise<void> {
  const label = Array.from(document.body.querySelectorAll('label'))
    .filter((candidate) => candidate.textContent === text)
    .at(-1)
  if (!(label instanceof HTMLLabelElement)) throw new Error(`missing label ${text}`)
  await act(async () => {
    label.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function checkboxForLabel(text: string): HTMLElement {
  const labels = Array.from(document.body.querySelectorAll('label')).filter((candidate) => candidate.textContent === text)
  const label = labels.at(-1)
  if (!(label instanceof HTMLLabelElement)) throw new Error(`missing label ${text}`)
  const checkbox = document.getElementById(label.htmlFor)
  if (!(checkbox instanceof HTMLElement)) throw new Error(`missing checkbox for ${text}`)
  return checkbox
}
