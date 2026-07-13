// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import React from 'react'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useBranchActions } from '#/web/hooks/useBranchActions.tsx'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import {
  createRepoBranch,
  repoPresentationFromQueryForTest,
  resetReposStore,
  seedRepoWithReadModelForTest,
  type RepoPresentationForTest,
} from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import type { ExecResult } from '#/web/types.ts'

const mocks = vi.hoisted(() => ({
  getRepoPatch: vi.fn(),
  openRepoEditor: vi.fn(),
  openRepoInFinder: vi.fn(),
  openRepoTerminal: vi.fn(),
  openRepoUrl: vi.fn(),
  openExternalUrl: vi.fn(),
}))

vi.mock('#/web/repo-client.ts', () => ({
  getRepoPatch: mocks.getRepoPatch,
  openRepoEditor: mocks.openRepoEditor,
  openRepoInFinder: mocks.openRepoInFinder,
  openRepoTerminal: mocks.openRepoTerminal,
  openRepoUrl: mocks.openRepoUrl,
}))

vi.mock('#/web/app-shell-client.ts', () => ({
  openExternalUrl: mocks.openExternalUrl,
}))

const REPO_ID = '/tmp/goblin-use-branch-actions-test-repo'

describe('useBranchActions', () => {
  beforeEach(() => {
    resetReposStore()
    mocks.getRepoPatch.mockReset()
    mocks.openRepoEditor.mockReset()
    mocks.openRepoInFinder.mockReset()
    mocks.openRepoTerminal.mockReset()
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
    const repo = seedRepoWithReadModelForTest({
      id: target!.id,
      branches: [branch],
      remote: {
        lifecycle: { kind: 'ready', target: target! },
        remotes: ['origin'],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })
    mocks.openRepoTerminal.mockResolvedValue({ ok: true, message: '' })

    let actions: ReturnType<typeof useBranchActions>['actions'] | null = null
    renderInJsdom(
      <BranchActionsHarness repo={repoPresentationFromQueryForTest(repo)} onReady={(value) => (actions = value)} />,
    )

    await act(async () => {
      await actions?.openTerminal?.('ghostty')
    })

    expect(mocks.openRepoTerminal).toHaveBeenCalledWith(
      target!.id,
      repo.repoRuntimeId,
      '/srv/repo-feature',
      'ghostty',
    )
  })

  test('copyPatch reads the server patch through a mutation and writes it to the clipboard', async () => {
    const branch = createRepoBranch('feature/local', { worktree: { path: '/tmp/local-feature' } })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
    })
    mocks.getRepoPatch.mockResolvedValue({ ok: true, message: 'diff --git a/file.ts b/file.ts' })
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    let actions: ReturnType<typeof useBranchActions>['actions'] | null = null
    renderInJsdom(
      <BranchActionsHarness repo={repoPresentationFromQueryForTest(repo)} onReady={(value) => (actions = value)} />,
    )

    let result = false
    await act(async () => {
      result = (await actions?.copyPatch()) ?? false
    })

    expect(result).toBe(true)
    expect(mocks.getRepoPatch).toHaveBeenCalledWith(REPO_ID, repo.repoRuntimeId, '/tmp/local-feature')
    expect(writeText).toHaveBeenCalledWith('diff --git a/file.ts b/file.ts')
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
    const repo = seedRepoWithReadModelForTest({
      id: target!.id,
      branches: [branch],
      remote: {
        lifecycle: { kind: 'ready', target: target! },
        remotes: ['origin'],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })
    mocks.openRepoEditor.mockResolvedValue({ ok: true, message: '' })

    let actions: ReturnType<typeof useBranchActions>['actions'] | null = null
    renderInJsdom(
      <BranchActionsHarness repo={repoPresentationFromQueryForTest(repo)} onReady={(value) => (actions = value)} />,
    )

    await act(async () => {
      await actions?.openEditor?.('vscode')
    })

    expect(mocks.openRepoEditor).toHaveBeenCalledWith(target!.id, repo.repoRuntimeId, '/srv/repo-feature', 'vscode')
  })

  test('openTerminal and openEditor forward explicit app choices for remote repos', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const branch = createRepoBranch('feature/remote', { worktree: { path: '/srv/repo-feature' } })
    const repo = seedRepoWithReadModelForTest({
      id: target!.id,
      branches: [branch],
      remote: {
        lifecycle: { kind: 'ready', target: target! },
        remotes: ['origin'],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })
    mocks.openRepoTerminal.mockResolvedValue({ ok: true, message: '' })
    mocks.openRepoEditor.mockResolvedValue({ ok: true, message: '' })

    let actions: ReturnType<typeof useBranchActions>['actions'] | null = null
    renderInJsdom(
      <BranchActionsHarness repo={repoPresentationFromQueryForTest(repo)} onReady={(value) => (actions = value)} />,
    )

    await act(async () => {
      await actions?.openTerminal?.('ghostty')
    })
    await act(async () => {
      await actions?.openEditor?.('vscode')
    })

    expect(mocks.openRepoTerminal).toHaveBeenCalledWith(
      target!.id,
      repo.repoRuntimeId,
      '/srv/repo-feature',
      'ghostty',
    )
    expect(mocks.openRepoEditor).toHaveBeenCalledWith(target!.id, repo.repoRuntimeId, '/srv/repo-feature', 'vscode')
  })

  test('openTerminal uses the embedded server route for non-remote repos', async () => {
    const branch = createRepoBranch('feature/local', { worktree: { path: '/tmp/local-feature' } })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
    })
    mocks.openRepoTerminal.mockResolvedValue({ ok: true, message: '' })

    let actions: ReturnType<typeof useBranchActions>['actions'] | null = null
    renderInJsdom(
      <BranchActionsHarness repo={repoPresentationFromQueryForTest(repo)} onReady={(value) => (actions = value)} />,
    )

    await act(async () => {
      await actions?.openTerminal?.('ghostty')
    })

    expect(mocks.openRepoTerminal).toHaveBeenCalledWith(REPO_ID, repo.repoRuntimeId, '/tmp/local-feature', 'ghostty')
  })

  test('openEditor forwards an explicit editor app for local repos', async () => {
    const branch = createRepoBranch('feature/local', { worktree: { path: '/tmp/local-feature' } })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
    })
    mocks.openRepoEditor.mockResolvedValue({ ok: true, message: '' })

    let actions: ReturnType<typeof useBranchActions>['actions'] | null = null
    renderInJsdom(
      <BranchActionsHarness repo={repoPresentationFromQueryForTest(repo)} onReady={(value) => (actions = value)} />,
    )

    await act(async () => {
      await actions?.openEditor?.('vscode')
    })

    expect(mocks.openRepoEditor).toHaveBeenCalledWith(REPO_ID, repo.repoRuntimeId, '/tmp/local-feature', 'vscode')
  })

  test('openFinder uses the embedded server route for non-remote repos', async () => {
    const branch = createRepoBranch('feature/local', { worktree: { path: '/tmp/local-feature' } })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
    })
    mocks.openRepoInFinder.mockResolvedValue({ ok: true, message: '/tmp/local-feature' })

    let actions: ReturnType<typeof useBranchActions>['actions'] | null = null
    renderInJsdom(
      <BranchActionsHarness repo={repoPresentationFromQueryForTest(repo)} onReady={(value) => (actions = value)} />,
    )

    await act(async () => {
      await actions?.openFinder?.()
    })

    expect(mocks.openRepoInFinder).toHaveBeenCalledWith(REPO_ID, '/tmp/local-feature')
  })

  test('clears local pending state when the branch action target changes', async () => {
    const firstOpen = deferred<ExecResult>()
    const branchA = createRepoBranch('feature/a', { worktree: { path: '/tmp/local-feature-a' } })
    const branchB = createRepoBranch('feature/b', { worktree: { path: '/tmp/local-feature-b' } })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branchA, branchB],
    })
    mocks.openRepoTerminal.mockReturnValue(firstOpen.promise)

    const surfaceRef: { current: ReturnType<typeof useBranchActions> | null } = { current: null }
    const view = renderInJsdom(
      <BranchActionsSurfaceHarness
        repo={repoPresentationFromQueryForTest(repo)}
        branchIndex={0}
        onReady={(value) => {
          surfaceRef.current = value
        }}
      />,
    )

    act(() => {
      void surfaceRef.current?.actions.openTerminal?.('ghostty')
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(surfaceRef.current?.busyAction).toBe('terminal')
    expect(surfaceRef.current?.blocked).toBe(true)

    act(() => {
      view.rerender(
        <BranchActionsSurfaceHarness
          repo={repoPresentationFromQueryForTest(repo)}
          branchIndex={1}
          onReady={(value) => {
            surfaceRef.current = value
          }}
        />,
      )
    })

    expect(surfaceRef.current?.busyAction).toBeNull()
    expect(surfaceRef.current?.blocked).toBe(false)

    await act(async () => {
      firstOpen.resolve({ ok: true, message: '' })
      await firstOpen.promise
    })
  })
})

function BranchActionsHarness({
  repo,
  onReady,
}: {
  repo: RepoPresentationForTest
  onReady: (actions: ReturnType<typeof useBranchActions>['actions']) => void
}) {
  return (
    <QueryClientProvider client={primaryWindowQueryClient}>
      <BranchActionsHarnessInner repo={repo} onReady={onReady} />
    </QueryClientProvider>
  )
}

function BranchActionsHarnessInner({
  repo,
  onReady,
}: {
  repo: RepoPresentationForTest
  onReady: (actions: ReturnType<typeof useBranchActions>['actions']) => void
}) {
  const branch = repo.branchModel.branches[0]!
  const { actions } = useBranchActions(repo, branch)
  React.useEffect(() => {
    onReady(actions)
  }, [actions, onReady])
  return null
}

function BranchActionsSurfaceHarness({
  repo,
  branchIndex,
  onReady,
}: {
  repo: RepoPresentationForTest
  branchIndex: number
  onReady: (surface: ReturnType<typeof useBranchActions>) => void
}) {
  return (
    <QueryClientProvider client={primaryWindowQueryClient}>
      <BranchActionsSurfaceHarnessInner repo={repo} branchIndex={branchIndex} onReady={onReady} />
    </QueryClientProvider>
  )
}

function BranchActionsSurfaceHarnessInner({
  repo,
  branchIndex,
  onReady,
}: {
  repo: RepoPresentationForTest
  branchIndex: number
  onReady: (surface: ReturnType<typeof useBranchActions>) => void
}) {
  const branch = repo.branchModel.branches[branchIndex]!
  const surface = useBranchActions(repo, branch)
  React.useEffect(() => {
    onReady(surface)
  }, [surface, onReady])
  return null
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}
