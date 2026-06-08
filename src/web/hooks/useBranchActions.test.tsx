// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { useBranchActions } from '#/web/hooks/useBranchActions.tsx'
import { openBranchExternalTarget } from '#/web/hooks/openBranchExternalTarget.ts'
import { createPullRequest, createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
  openRepositoryEditor: vi.fn(),
  openRepositoryRemote: vi.fn(),
  openRepositoryTerminal: vi.fn(),
  openRemoteRepositoryEditor: vi.fn(),
  showRepoDetailTab: vi.fn(),
}))

vi.mock('#/web/app-shell-client.ts', () => ({
  openExternalUrl: mocks.openExternalUrl,
}))

vi.mock('#/web/app-data-client.ts', () => ({
  getRepositoryPatch: vi.fn(),
  openRepositoryEditor: mocks.openRepositoryEditor,
  openRepositoryRemote: mocks.openRepositoryRemote,
  openRepositoryTerminal: mocks.openRepositoryTerminal,
  openRemoteRepositoryEditor: mocks.openRemoteRepositoryEditor,
}))

vi.mock('#/web/main-window-navigation.tsx', () => ({
  useMainWindowNavigation: () => ({
    showRepoDetailTab: mocks.showRepoDetailTab,
  }),
}))

const REPO_ID = '/tmp/gbl-use-branch-actions-test-repo'

describe('useBranchActions', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

  beforeEach(() => {
    resetReposStore()
    mocks.openExternalUrl.mockReset()
    mocks.openRepositoryEditor.mockReset()
    mocks.openRepositoryRemote.mockReset()
    mocks.openRepositoryTerminal.mockReset()
    mocks.openRemoteRepositoryEditor.mockReset()
    mocks.showRepoDetailTab.mockReset()
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

  test('opens remote terminals in the Goblin terminal detail tab', async () => {
    const branch = createRepoBranch('feature/remote-terminal', { worktree: { path: '/srv/repo-feature' } })
    const target = normalizeRemoteTarget({
      alias: 'prod',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const repo = seedRepoState({
      id: target!.id,
      branches: [branch],
      remote: { target: target!, hasRemotes: true, hasBrowserRemote: true, hasGitHubRemote: true },
    })

    let actions: ReturnType<typeof useBranchActions>['actions'] | null = null
    root = createRoot(container)
    await act(async () => {
      root!.render(<BranchActionsHarness repo={repo} onReady={(value) => (actions = value)} />)
    })

    await act(async () => {
      await actions?.openTerminal?.()
    })

    expect(mocks.showRepoDetailTab).toHaveBeenCalledWith(target!.id, 'terminal')
    expect(mocks.openRepositoryTerminal).not.toHaveBeenCalled()
  })

  test('opens remote editors through the remote editor client', async () => {
    mocks.openRemoteRepositoryEditor.mockResolvedValue({ ok: true, message: '' })
    const branch = createRepoBranch('feature/remote-editor', { worktree: { path: '/srv/repo-feature' } })
    const target = normalizeRemoteTarget({
      alias: 'prod',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const repo = seedRepoState({
      id: target!.id,
      branches: [branch],
      remote: { target: target!, hasRemotes: true, hasBrowserRemote: true, hasGitHubRemote: true },
    })

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
