// @vitest-environment jsdom

import { cleanup, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CreateWorktreeDialog } from '#/web/components/create-worktree-dialog/CreateWorktreeDialog.tsx'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import { getRepoRemoteBranches } from '#/web/repo-client.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoSnapshotQueryData } from '#/web/repo-data-query.ts'
import { createRepoBranch } from '#/web/test-utils/bridge.ts'

vi.mock('#/web/repo-client.ts', async () => {
  const actual = await vi.importActual<typeof import('#/web/repo-client.ts')>('#/web/repo-client.ts')
  return {
    ...actual,
    getRepoRemoteBranches: vi.fn(),
  }
})

const testWindow = window as unknown as {
  goblinNative?: unknown
  __GOBLIN_BOOTSTRAP__?: unknown
}

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

describe('CreateWorktreeDialog', () => {
  test('focuses the new branch input when opened in newBranch mode', () => {
    render(<CreateWorktreeDialog open repo={createRepo()} onClose={vi.fn()} onCreate={vi.fn(async () => {})} />)

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /action.create-worktree-branch-label/i }))
  })

  test('disables submit until the form is valid', async () => {
    const user = userEvent.setup()
    render(<CreateWorktreeDialog open repo={createRepo()} onClose={vi.fn()} onCreate={vi.fn()} />)

    const submitButton = screen.getByRole('button', { name: /action.create-worktree-confirm/i }) as HTMLButtonElement
    expect(submitButton.disabled).toBe(true)

    await user.type(screen.getByRole('textbox', { name: /action.create-worktree-branch-label/i }), 'feature/new')

    await waitFor(() => {
      expect(submitButton.disabled).toBe(false)
    })
  })

  test('shows an error when the new branch name already exists', async () => {
    const user = userEvent.setup()
    render(<CreateWorktreeDialog open repo={createRepo()} onClose={vi.fn()} onCreate={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: /action.create-worktree-branch-label/i }), 'main')

    await waitFor(() => {
      expect(
        screen.getByRole('textbox', { name: /action.create-worktree-branch-label/i }).getAttribute('aria-invalid'),
      ).toBe('true')
    })
  })

  test('updates the default path placeholder when the branch changes', async () => {
    const user = userEvent.setup()
    render(<CreateWorktreeDialog open repo={createRepo()} onClose={vi.fn()} onCreate={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: /action.create-worktree-branch-label/i }), 'feature/new')

    await waitFor(() => {
      expect(
        screen.getByRole('textbox', { name: /action.create-worktree-path-label/i }).getAttribute('placeholder'),
      ).toContain('feature-new')
    })
  })

  test('submits a newBranch request and closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onCreate = vi.fn(() => Promise.resolve())

    render(<CreateWorktreeDialog open repo={createRepo()} onClose={onClose} onCreate={onCreate} />)

    await user.type(screen.getByRole('textbox', { name: /action.create-worktree-branch-label/i }), 'feature/new')
    await user.click(screen.getByRole('button', { name: /action.create-worktree-confirm/i }))

    expect(onCreate).toHaveBeenCalledWith({
      input: {
        worktreePath: '/tmp/goblin-repo-feature-new',
        mode: { kind: 'newBranch', newBranch: 'feature/new', baseRef: 'main' },
      },
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('uses the React Query snapshot read model for local branch choices', async () => {
    const user = userEvent.setup()
    const repo = createRepo()
    repo.data.currentBranch = ''
    repo.data.branches = []
    setRepoSnapshotQueryData(repo.id, repo.instanceId, {
      current: 'main',
      branches: [createRepoBranch('main'), createRepoBranch('feature/base')],
    })
    const onCreate = vi.fn(async () => {})

    render(<CreateWorktreeDialog open repo={repo} onClose={vi.fn()} onCreate={onCreate} />)

    await user.type(screen.getByRole('textbox', { name: /action.create-worktree-branch-label/i }), 'feature/query')
    await user.click(screen.getByRole('button', { name: /action.create-worktree-confirm/i }))

    expect(onCreate).toHaveBeenCalledWith({
      input: {
        worktreePath: '/tmp/goblin-repo-feature-query',
        mode: { kind: 'newBranch', newBranch: 'feature/query', baseRef: 'main' },
      },
    })
  })

  test('switches to existingBranch mode and submits the selected branch', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onCreate = vi.fn(async () => {})

    render(<CreateWorktreeDialog open repo={createRepo()} onClose={onClose} onCreate={onCreate} />)

    await user.click(screen.getByRole('radio', { name: /action.create-worktree-mode-existing/i }))

    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: /action.create-worktree-confirm/i }) as HTMLButtonElement).disabled,
      ).toBe(false)
    })

    await user.click(screen.getByRole('button', { name: /action.create-worktree-confirm/i }))

    expect(onCreate).toHaveBeenCalledWith({
      input: {
        worktreePath: '/tmp/goblin-repo-main',
        mode: { kind: 'existingBranch', branch: 'main' },
      },
    })
  })

  test('loads remote branches and submits trackRemoteBranch with the first ref', async () => {
    vi.mocked(getRepoRemoteBranches).mockResolvedValue(['origin/feature', 'origin/main'])
    const user = userEvent.setup()
    const onCreate = vi.fn(async () => {})

    render(<CreateWorktreeDialog open repo={createRemoteRepo()} onClose={vi.fn()} onCreate={onCreate} />)

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
        worktreePath: '/srv/repo-feature',
        mode: { kind: 'trackRemoteBranch', remoteRef: 'origin/feature', localBranch: 'feature' },
      },
    })
  })

  test('keeps home-relative remote worktree paths in the submitted payload', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onCreate = vi.fn(async () => {})

    render(<CreateWorktreeDialog open repo={createRemoteRepo()} onClose={onClose} onCreate={onCreate} />)

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
})

function createRepo(): RepoState {
  const repo = emptyRepo('/tmp/goblin-repo', 'goblin-repo', 'repo-instance-test')
  repo.data.currentBranch = 'main'
  repo.data.branches = [
    {
      name: 'main',
      isCurrent: true,
      ahead: 0,
      behind: 0,
      lastCommitHash: '1111111000000000000000000000000000000000',
      lastCommitShortHash: '1111111',
      lastCommitMessage: 'Main commit',
      lastCommitDate: '2024-01-01T00:00:00.000Z',
      lastCommitAuthor: 'Test',
    },
    {
      name: 'feature/base',
      isCurrent: false,
      ahead: 0,
      behind: 0,
      lastCommitHash: '2222222000000000000000000000000000000000',
      lastCommitShortHash: '2222222',
      lastCommitMessage: 'Feature base',
      lastCommitDate: '2024-01-02T00:00:00.000Z',
      lastCommitAuthor: 'Test',
    },
  ]
  setRepoSnapshotQueryData(repo.id, repo.instanceId, {
    current: repo.data.currentBranch,
    branches: repo.data.branches,
  })
  return repo
}

function createRemoteRepo(): RepoState {
  const target = normalizeRemoteTarget({
    alias: 'prod',
    host: 'example.com',
    user: 'alice',
    port: 22,
    remotePath: '/srv/repo',
  })
  if (!target) throw new Error('Failed to create remote target for test')
  const repo = createRepo()
  repo.id = target.id
  repo.remote.lifecycle = { kind: 'ready', target }
  setRepoSnapshotQueryData(repo.id, repo.instanceId, {
    current: repo.data.currentBranch,
    branches: repo.data.branches,
  })
  return repo
}
