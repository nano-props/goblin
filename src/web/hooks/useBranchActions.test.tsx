// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { useBranchActions } from '#/web/hooks/useBranchActions.tsx'
import { openBranchExternalTarget } from '#/web/hooks/openBranchExternalTarget.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import { createPullRequest, createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
  openRepositoryRemote: vi.fn(),
  openRepositoryEditor: vi.fn(),
  openRepositoryTerminal: vi.fn(),
  openRemoteRepositoryEditor: vi.fn(),
  openRemoteRepositoryTerminal: vi.fn(),
}))

vi.mock('#/web/app-shell-client.ts', () => ({
  openExternalUrl: mocks.openExternalUrl,
}))

vi.mock('#/web/repo-client.ts', () => ({
  getRepositoryPatch: vi.fn(),
  openRepositoryEditor: mocks.openRepositoryEditor,
  openRepositoryRemote: mocks.openRepositoryRemote,
  openRepositoryTerminal: mocks.openRepositoryTerminal,
}))

vi.mock('#/web/remote-client.ts', () => ({
  openRemoteRepositoryEditor: mocks.openRemoteRepositoryEditor,
  openRemoteRepositoryTerminal: mocks.openRemoteRepositoryTerminal,
}))

const REPO_ID = '/tmp/gbl-use-branch-actions-test-repo'

describe('useBranchActions', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

  beforeEach(() => {
    resetReposStore()
    mocks.openExternalUrl.mockReset()
    mocks.openRepositoryRemote.mockReset()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    root = null
  })

  test('opens the existing pull request URL when present', async () => {
    const branch = createRepoBranch('feature/pr', {
      pullRequest: createPullRequest(28689, { url: 'https://github.com/acme/repo/pull/28689' }),
    })
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [branch],
      remote: {
        remotes: ['origin'],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })
    mocks.openExternalUrl.mockResolvedValue({ ok: true, message: '' })

    let actions: ReturnType<typeof useBranchActions>['actions'] | null = null
    root = createRoot(container)
    await act(async () => {
      root!.render(<BranchActionsHarness repo={repo} onReady={(value) => (actions = value)} />)
    })

    await act(async () => {
      await actions?.openRemote?.()
    })

    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://github.com/acme/repo/pull/28689')
    expect(mocks.openRepositoryRemote).not.toHaveBeenCalled()
  })

  test('falls back to the branch remote URL when no pull request exists', async () => {
    const branch = createRepoBranch('feature/no-pr')
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [branch],
      remote: {
        remotes: ['origin'],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })
    mocks.openRepositoryRemote.mockResolvedValue({ ok: true, message: '' })

    let actions: ReturnType<typeof useBranchActions>['actions'] | null = null
    root = createRoot(container)
    await act(async () => {
      root!.render(<BranchActionsHarness repo={repo} onReady={(value) => (actions = value)} />)
    })

    await act(async () => {
      await actions?.openRemote?.()
    })

    expect(mocks.openRepositoryRemote).toHaveBeenCalledWith(REPO_ID, 'feature/no-pr')
    expect(mocks.openExternalUrl).not.toHaveBeenCalled()
  })

  test('openTerminal routes to the remote IPC for remote repos', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const branch = createRepoBranch('feature/remote', { worktree: { path: '/srv/repo-feature' } })
    const repo = seedRepoState({
      id: target!.id,
      branches: [branch],
      remote: {
        target: target!,
        remotes: ['origin'],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })
    mocks.openRemoteRepositoryTerminal.mockResolvedValue({ ok: true, message: '' })

    let actions: ReturnType<typeof useBranchActions>['actions'] | null = null
    root = createRoot(container)
    await act(async () => {
      root!.render(<BranchActionsHarness repo={repo} onReady={(value) => (actions = value)} />)
    })

    await act(async () => {
      await actions?.openTerminal?.()
    })

    expect(mocks.openRemoteRepositoryTerminal).toHaveBeenCalledWith(target!.id, '/srv/repo-feature')
    expect(mocks.openRepositoryTerminal).not.toHaveBeenCalled()
  })

  test('openEditor routes to the remote IPC for remote repos', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const branch = createRepoBranch('feature/remote', { worktree: { path: '/srv/repo-feature' } })
    const repo = seedRepoState({
      id: target!.id,
      branches: [branch],
      remote: {
        target: target!,
        remotes: ['origin'],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })
    mocks.openRemoteRepositoryEditor.mockResolvedValue({ ok: true, message: '' })

    let actions: ReturnType<typeof useBranchActions>['actions'] | null = null
    root = createRoot(container)
    await act(async () => {
      root!.render(<BranchActionsHarness repo={repo} onReady={(value) => (actions = value)} />)
    })

    await act(async () => {
      await actions?.openEditor?.()
    })

    expect(mocks.openRemoteRepositoryEditor).toHaveBeenCalledWith(target!.id, '/srv/repo-feature')
    expect(mocks.openRepositoryEditor).not.toHaveBeenCalled()
  })

  test('openTerminal keeps the local IPC for non-remote repos', async () => {
    const branch = createRepoBranch('feature/local', { worktree: { path: '/tmp/local-feature' } })
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [branch],
    })
    mocks.openRepositoryTerminal.mockResolvedValue({ ok: true, message: '' })

    let actions: ReturnType<typeof useBranchActions>['actions'] | null = null
    root = createRoot(container)
    await act(async () => {
      root!.render(<BranchActionsHarness repo={repo} onReady={(value) => (actions = value)} />)
    })

    await act(async () => {
      await actions?.openTerminal?.()
    })

    expect(mocks.openRepositoryTerminal).toHaveBeenCalledWith('/tmp/local-feature')
    expect(mocks.openRemoteRepositoryTerminal).not.toHaveBeenCalled()
  })
})

describe('openBranchExternalTarget', () => {
  beforeEach(() => {
    mocks.openExternalUrl.mockReset()
    mocks.openRepositoryRemote.mockReset()
  })

  test('prefers the existing pull request URL', async () => {
    mocks.openExternalUrl.mockResolvedValue({ ok: true, message: '' })

    await openBranchExternalTarget(REPO_ID, {
      name: 'feature/pr',
      pullRequest: createPullRequest(28689, { url: 'https://github.com/acme/repo/pull/28689' }),
    })

    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://github.com/acme/repo/pull/28689')
    expect(mocks.openRepositoryRemote).not.toHaveBeenCalled()
  })

  test('falls back to the branch remote target when no pull request exists', async () => {
    mocks.openRepositoryRemote.mockResolvedValue({ ok: true, message: '' })

    await openBranchExternalTarget(REPO_ID, {
      name: 'feature/no-pr',
      pullRequest: undefined,
    })

    expect(mocks.openRepositoryRemote).toHaveBeenCalledWith(REPO_ID, 'feature/no-pr')
    expect(mocks.openExternalUrl).not.toHaveBeenCalled()
  })
})

function BranchActionsHarness({
  repo,
  onReady,
}: {
  repo: ReturnType<typeof seedRepoState>
  onReady: (actions: ReturnType<typeof useBranchActions>['actions']) => void
}) {
  const branch = repo.data.branches[0]!
  const { actions } = useBranchActions(repo, branch)
  React.useEffect(() => {
    onReady(actions)
  }, [actions, onReady])
  return null
}
