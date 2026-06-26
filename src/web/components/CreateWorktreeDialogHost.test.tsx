// @vitest-environment jsdom

// Regression test for the create-worktree dialog host. The original
// implementation mounted inside the per-repo action subtree and
// lost its form state every time the user navigated to Settings
// because that subtree unmounted. The fix moved the
// host to `Layout.MainWindowOverlays` (outside `<Outlet />`), so the
// dialog survives settings ⇄ workspace navigation.
//
// The subtle regression this protects against is closing the dialog
// on its own false→true transition. The host should only force-close
// when the active repo changes.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CreateWorktreeDialogHost } from '#/web/components/CreateWorktreeDialogHost.tsx'
import { mainWindowQueryClient } from '#/web/main-window-queries.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'

const REPO_ID = '/tmp/gbl-create-host-test'
let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  mainWindowQueryClient.clear()
  globalThis.localStorage?.clear()
  resetReposStore()
  seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('main', { isCurrent: true, ahead: 0, behind: 0 })],
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  vi.stubGlobal('fetch', vi.fn(async () => previewResponse({ hasOperations: false, configHash: null })))
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  mainWindowQueryClient.clear()
  globalThis.localStorage?.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

function renderHost(open: boolean, onOpenChange: (open: boolean) => void) {
  act(() => {
    root!.render(<CreateWorktreeDialogHost open={open} onOpenChange={onOpenChange} activeId={REPO_ID} />)
  })
}

describe('CreateWorktreeDialogHost', () => {
  test('regression: dialog stays open after the false→true transition', () => {
    // The bug: useEffect had `[activeId, onOpenChange, open]` in its
    // deps. When the user clicked the "create worktree" button, the
    // parent's `open` state flipped false→true, the host re-rendered,
    // and the effect fired (because `open` changed), calling
    // `onOpenChange(false)`. The dialog was unopenable from the UI.
    //
    // The fix only closes when the captured previous active repo differs
    // from the current `activeId`.
    // In the real flow the host is mounted in Layout with `open=false`
    // initially; the parent flips to `true` when the user clicks the
    // create-worktree button. This test reproduces that flow.
    const onOpenChange = vi.fn()

    // (1) Initial mount: open=false (the host always starts closed).
    renderHost(false, onOpenChange)
    expect(onOpenChange).not.toHaveBeenCalled()

    // (2) The user clicks the create-worktree button. Parent flips `open` to
    // true. The host re-renders; only `open` changed, not `activeId`.
    // The guarded effect must NOT call `onOpenChange(false)` — pre-fix
    // it did so in the same render.
    act(() => {
      root!.render(<CreateWorktreeDialogHost open={true} onOpenChange={onOpenChange} activeId={REPO_ID} />)
    })
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  test('does not close merely because it mounted open', () => {
    const onOpenChange = vi.fn()

    renderHost(true, onOpenChange)

    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  test('force-closes the dialog when the active repo changes (matches pre-PR behaviour)', () => {
    const onOpenChange = vi.fn()
    renderHost(true, onOpenChange)

    // Simulate the user switching active repo. The host must call
    // `onOpenChange(false)` so the dialog doesn't leak across the
    // boundary. The `activeId` dep flips, so the effect fires.
    act(() => {
      root!.render(<CreateWorktreeDialogHost open={true} onOpenChange={onOpenChange} activeId="/tmp/other-repo" />)
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('renders nothing when no active repo', () => {
    act(() => {
      root!.render(<CreateWorktreeDialogHost open onOpenChange={vi.fn()} activeId={null} />)
    })
    expect(container?.textContent ?? '').toBe('')
  })

  test('forwards a remembered bootstrap decision from the create dialog checkbox', async () => {
    const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    mainWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot())
    const submitBranchAction = vi.spyOn(useReposStore.getState(), 'submitBranchAction').mockImplementation(() => {})
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    vi.stubGlobal('fetch', fetchMock)

    renderHost(true, vi.fn())
    await flushReact()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('action.create-worktree-bootstrap-remember')
    expect(submitBranchAction).not.toHaveBeenCalled()

    setInputValue('cwt-branch', 'feature/bootstrap')
    await clickLabel('action.create-worktree-bootstrap-remember')
    await clickButton('action.create-worktree-confirm')
    await flushReact()

    expect(submitBranchAction).toHaveBeenCalledWith(
      REPO_ID,
      expect.objectContaining({
        kind: 'createWorktree',
        worktreeBootstrap: {
          kind: 'run',
          configHash,
          rememberTrust: true,
        },
      }),
      expect.objectContaining({ refreshOnError: false }),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('forwards a run-once bootstrap decision from the create dialog without checking trust', async () => {
    const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    mainWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot())
    const submitBranchAction = vi.spyOn(useReposStore.getState(), 'submitBranchAction').mockImplementation(() => {})
    const fetchMock = vi.fn(async () => {
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
    vi.stubGlobal('fetch', fetchMock)

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
          rememberTrust: false,
        },
      }),
      expect.objectContaining({ refreshOnError: false }),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('runs goblin.toml bootstrap once by default for untrusted configs', async () => {
    const submitBranchAction = vi.spyOn(useReposStore.getState(), 'submitBranchAction').mockImplementation(() => {})
    const fetchMock = vi.fn(async () => {
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
    vi.stubGlobal('fetch', fetchMock)

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
          rememberTrust: false,
        },
      }),
      expect.objectContaining({ refreshOnError: false }),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('preflights then auto-runs a trusted goblin.toml config hash', async () => {
    mainWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
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
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
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
    vi.stubGlobal('fetch', fetchMock)

    renderHost(true, vi.fn())
    await flushReact()
    setInputValue('cwt-branch', 'feature/trusted')
    await clickButton('action.create-worktree-confirm')
    await flushReact()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain('action.create-worktree-bootstrap-remember')
    expect(submitBranchAction).toHaveBeenCalledWith(
      REPO_ID,
      expect.objectContaining({
        kind: 'createWorktree',
        worktreeBootstrap: {
          kind: 'run',
          configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          rememberTrust: false,
        },
      }),
      expect.objectContaining({ refreshOnError: false }),
    )
  })

  test('keeps trusted bootstrap state in sync when settings cache updates after preview', async () => {
    const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    mainWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot())
    const submitBranchAction = vi.spyOn(useReposStore.getState(), 'submitBranchAction').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => previewResponse({ hasOperations: true, configHash })),
    )

    renderHost(true, vi.fn())
    await flushReact()

    expect(document.body.textContent).toContain('action.create-worktree-bootstrap-remember')

    act(() => {
      mainWindowQueryClient.setQueryData(
        settingsSnapshotQueryKey(),
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
    })
    await flushReact()

    expect(document.body.textContent).not.toContain('action.create-worktree-bootstrap-remember')

    setInputValue('cwt-branch', 'feature/trusted-after-preview')
    await clickButton('action.create-worktree-confirm')
    await flushReact()

    expect(submitBranchAction).toHaveBeenCalledWith(
      REPO_ID,
      expect.objectContaining({
        kind: 'createWorktree',
        worktreeBootstrap: { kind: 'run', configHash, rememberTrust: false },
      }),
      expect.objectContaining({ refreshOnError: false }),
    )
  })

  test('shows preview errors and skips bootstrap when creating anyway', async () => {
    mainWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot())
    const submitBranchAction = vi.spyOn(useReposStore.getState(), 'submitBranchAction').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(JSON.stringify({ ok: false, message: 'invalid goblin.toml' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    renderHost(true, vi.fn())
    await flushReact()

    expect(document.body.textContent).not.toContain('action.create-worktree-bootstrap-error')
    expect(document.body.textContent).not.toContain('action.create-worktree-bootstrap-remember')
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
    mainWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
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
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname !== '/api/repo/worktree-bootstrap-preview') {
        throw new Error(`unexpected request ${url.pathname}`)
      }
      const next = previewResponses.shift()
      if (!next) throw new Error('unexpected preview request')
      return next.promise
    })
    vi.stubGlobal('fetch', fetchMock)

    renderHost(true, vi.fn())
    await flushReact()
    act(() => {
      root!.render(<CreateWorktreeDialogHost open={false} onOpenChange={vi.fn()} activeId={REPO_ID} />)
    })
    act(() => {
      root!.render(<CreateWorktreeDialogHost open={true} onOpenChange={vi.fn()} activeId={REPO_ID} />)
    })
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
        worktreeBootstrap: { kind: 'run', configHash, rememberTrust: false },
      }),
      expect.objectContaining({ refreshOnError: false }),
    )
  })

})

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
  const input = document.getElementById(id)
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
  const button = Array.from(document.querySelectorAll('button')).find((candidate) => candidate.textContent === text)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button ${text}`)
  await act(async () => {
    button.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function clickLabel(text: string): Promise<void> {
  const label = Array.from(document.querySelectorAll('label')).find((candidate) => candidate.textContent === text)
  if (!(label instanceof HTMLLabelElement)) throw new Error(`missing label ${text}`)
  await act(async () => {
    label.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}
