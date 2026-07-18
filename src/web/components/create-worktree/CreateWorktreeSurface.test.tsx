// @vitest-environment jsdom

import { cleanup, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CreateWorktreePageBody } from '#/web/components/create-worktree/CreateWorktreeSurface.tsx'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import { getRepoRemoteBranches } from '#/web/repo-client.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { createRepoBranch, repoPresentationForTest, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import type { RepoPresentationForTest } from '#/web/test-utils/bridge.ts'
import type { WorktreeBootstrapPreview } from '#/shared/worktree-bootstrap-summary.ts'

vi.mock('#/web/repo-client.ts', async () => {
  const actual = await vi.importActual<typeof import('#/web/repo-client.ts')>('#/web/repo-client.ts')
  return { ...actual, getRepoRemoteBranches: vi.fn() }
})

const testWindow = window as unknown as { goblinNative?: unknown; __GOBLIN_BOOTSTRAP__?: unknown }

beforeEach(() => {
  primaryWindowQueryClient.clear()
  testWindow.__GOBLIN_BOOTSTRAP__ = {
    runtime: { kind: 'electron', bridgeVersion: 1, capabilities: [] },
    initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
  }
  testWindow.goblinNative = {
    initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
    pathForFile: () => '',
    invokeIpc: async () => null,
    abortIpc: async () => true,
    onEvent: () => () => {},
  }
  vi.mocked(getRepoRemoteBranches).mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  delete testWindow.goblinNative
  delete testWindow.__GOBLIN_BOOTSTRAP__
})

function render(ui: ReactElement) {
  return rtlRender(<QueryClientProvider client={primaryWindowQueryClient}>{ui}</QueryClientProvider>)
}

describe('CreateWorktreePageBody', () => {
  test('does not steal focus when the page mounts', () => {
    render(<CreateWorktreePageBody repo={createRepo()} onCancel={vi.fn()} onCreate={vi.fn()} />)

    expect(document.activeElement).toBe(document.body)
  })

  test('disables submit until the form is valid', async () => {
    const user = userEvent.setup()
    render(<CreateWorktreePageBody repo={createRepo()} onCancel={vi.fn()} onCreate={vi.fn()} />)

    const submitButton = screen.getByRole('button', { name: /action.create-worktree-confirm/i }) as HTMLButtonElement
    expect(submitButton.disabled).toBe(true)

    await user.type(screen.getByRole('textbox', { name: /action.create-worktree-branch-label/i }), 'feature/new')

    await waitFor(() => {
      expect(submitButton.disabled).toBe(false)
    })
  })

  test('shows an error when the new branch name already exists', async () => {
    const user = userEvent.setup()
    render(<CreateWorktreePageBody repo={createRepo()} onCancel={vi.fn()} onCreate={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: /action.create-worktree-branch-label/i }), 'main')

    await waitFor(() => {
      expect(
        screen.getByRole('textbox', { name: /action.create-worktree-branch-label/i }).getAttribute('aria-invalid'),
      ).toBe('true')
    })
  })

  test('submits a newBranch request and cancels when accepted', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onCreate = vi.fn(() => Promise.resolve())

    render(<CreateWorktreePageBody repo={createRepo()} onCancel={onCancel} onCreate={onCreate} />)

    await user.type(screen.getByRole('textbox', { name: /action.create-worktree-branch-label/i }), 'feature/new')
    await user.click(screen.getByRole('button', { name: /action.create-worktree-confirm/i }))

    expect(onCreate).toHaveBeenCalledWith({
      input: {
        worktreePath: '/tmp/goblin-repo-feature-new',
        mode: { kind: 'newBranch', newBranch: 'feature/new', baseRef: 'main' },
      },
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test('keeps the form in creating state when live branch data gains the submitted worktree', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    let resolveCreate!: () => void
    const onCreate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = resolve
        }),
    )

    const view = render(<CreateWorktreePageBody repo={createRepo()} onCancel={onCancel} onCreate={onCreate} />)

    await user.type(screen.getByRole('textbox', { name: /action.create-worktree-branch-label/i }), 'feature/new')
    await user.click(screen.getByRole('button', { name: /action.create-worktree-confirm/i }))

    expect(
      (screen.getByRole('button', { name: /action.create-worktree-creating-title/i }) as HTMLButtonElement).disabled,
    ).toBe(true)

    view.rerender(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <CreateWorktreePageBody repo={createRepoWithCreatedWorktree()} onCancel={onCancel} onCreate={onCreate} />
      </QueryClientProvider>,
    )

    const branchInput = screen.getByRole('textbox', { name: /action.create-worktree-branch-label/i })
    expect(branchInput.getAttribute('aria-invalid')).toBe('false')
    expect(screen.queryByText(/action.create-worktree-has-worktree/i)).toBeNull()
    expect(
      (screen.getByRole('button', { name: /action.create-worktree-creating-title/i }) as HTMLButtonElement).disabled,
    ).toBe(true)

    resolveCreate()
    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })

  test('switches to existingBranch mode and submits the selected branch', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn(async () => {})

    render(<CreateWorktreePageBody repo={createRepo()} onCancel={vi.fn()} onCreate={onCreate} />)

    await user.click(screen.getByRole('radio', { name: /action.create-worktree-mode-existing/i }))
    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: /action.create-worktree-confirm/i }) as HTMLButtonElement).disabled,
      ).toBe(false)
    })
    await user.click(screen.getByRole('button', { name: /action.create-worktree-confirm/i }))

    expect(onCreate).toHaveBeenCalledWith({
      input: { worktreePath: '/tmp/goblin-repo-main', mode: { kind: 'existingBranch', branch: 'main' } },
    })
  })

  test('loads remote branches and submits trackRemoteBranch with the first ref', async () => {
    vi.mocked(getRepoRemoteBranches).mockResolvedValue(['origin/feature', 'origin/main'])
    const user = userEvent.setup()
    const onCreate = vi.fn(async () => {})

    render(<CreateWorktreePageBody repo={createRemoteRepo()} onCancel={vi.fn()} onCreate={onCreate} />)

    await user.click(screen.getByRole('radio', { name: /action.create-worktree-mode-remote/i }))
    await waitFor(() => {
      expect(getRepoRemoteBranches).toHaveBeenCalledTimes(1)
    })
    const submitButton = screen.getByRole('button', { name: /action.create-worktree-confirm/i }) as HTMLButtonElement
    await waitFor(() => {
      expect(submitButton.disabled).toBe(false)
    })
    await user.click(submitButton)

    expect(onCreate).toHaveBeenCalledWith({
      input: {
        worktreePath: '/tmp/goblin-repo-feature',
        mode: { kind: 'trackRemoteBranch', remoteRef: 'origin/feature', localBranch: 'feature' },
      },
    })
  })

  test('keeps home-relative remote worktree paths in the submitted payload', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn(async () => {})

    render(<CreateWorktreePageBody repo={createRemoteRepo()} onCancel={vi.fn()} onCreate={onCreate} />)

    await user.type(screen.getByRole('textbox', { name: /action.create-worktree-branch-label/i }), 'feature/new')
    const pathInput = screen.getByRole('textbox', { name: /action.create-worktree-path-label/i })
    await user.clear(pathInput)
    await user.type(pathInput, '~/trees/repo-feature-new')
    await user.click(screen.getByRole('button', { name: /action.create-worktree-confirm/i }))

    expect(onCreate).toHaveBeenCalledWith({
      input: {
        worktreePath: '~/trees/repo-feature-new',
        mode: { kind: 'newBranch', newBranch: 'feature/new', baseRef: 'main' },
      },
    })
  })

  test('hides the trust prompt row entirely when neither loading nor needed', () => {
    render(
      <CreateWorktreePageBody
        repo={createRepo()}
        worktreeBootstrap={{
          loading: false,
          preview: null,
          error: false,
          configTrusted: false,
          onConfigTrustedChange: vi.fn(),
        }}
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    )

    expect(screen.queryByText(/action.create-worktree-bootstrap-config-trusted/i)).toBeNull()
  })

  test('shows the trust prompt when bootstrap operations are present', () => {
    const preview = {
      hasOperations: true,
      configHash: 'config-hash',
    } as WorktreeBootstrapPreview

    render(
      <CreateWorktreePageBody
        repo={createRepo()}
        worktreeBootstrap={{
          loading: false,
          preview,
          error: false,
          configTrusted: false,
          onConfigTrustedChange: vi.fn(),
        }}
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    )

    expect(screen.getByText(/action.create-worktree-bootstrap-config-trusted/i)).toBeTruthy()
  })
})

function createRepo(): RepoPresentationForTest {
  const branches = [createRepoBranch('main'), createRepoBranch('feature/base')]
  const repo = seedRepoWithReadModelForTest({
    id: '/tmp/goblin-repo',
    name: 'goblin-repo',
    workspaceRuntimeId: 'repo-runtime-test',
    branches,
    currentBranch: 'main',
  })
  return repoPresentationForTest(repo, { currentBranch: 'main', branches, status: [], worktreesByPath: {} })
}

function createRepoWithCreatedWorktree(): RepoPresentationForTest {
  const branches = [
    createRepoBranch('main'),
    createRepoBranch('feature/base'),
    createRepoBranch('feature/new', { worktree: { path: '/tmp/goblin-repo-feature-new' } }),
  ]
  const repo = seedRepoWithReadModelForTest({
    id: '/tmp/goblin-repo',
    name: 'goblin-repo',
    workspaceRuntimeId: 'repo-runtime-test',
    branches,
    currentBranch: 'main',
  })
  return repoPresentationForTest(repo, { currentBranch: 'main', branches, status: [], worktreesByPath: {} })
}

function createRemoteRepo(): RepoPresentationForTest {
  const target = normalizeRemoteTarget({
    alias: 'dev',
    remotePath: '/srv/repo',
    host: 'example.test',
    user: 'dev',
    port: 22,
  })
  if (!target) throw new Error('invalid target')
  const repo = createRepo()
  return { ...repo, remoteLifecycle: { kind: 'ready', target } }
}
