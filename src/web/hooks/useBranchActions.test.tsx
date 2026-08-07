// @vitest-environment jsdom

import {
  repoPresentationFromQueryForTest,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  createRepoBranch,
} from '#/web/test-utils/repo-store.ts'
import type { RepoPresentationForTest } from '#/web/test-utils/repo-store.ts'
import { act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useBranchActions } from '#/web/hooks/useBranchActions.tsx'
import { normalizeRemoteTarget } from '#/shared/remote-workspace.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import { gitWorktreeFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { requireGitWorkspaceClientState } from '#/web/stores/workspaces/git-workspace-client-state.ts'
import { renderHookInJsdom } from '#/test-utils/render.tsx'

const mocks = vi.hoisted(() => ({
  getRepoPatch: vi.fn(),
  openWorkspaceEditor: vi.fn(),
  openWorkspaceInFinder: vi.fn(),
  openWorkspaceTerminal: vi.fn(),
  openRepoUrl: vi.fn(),
  openExternalUrl: vi.fn(),
}))

vi.mock('#/web/repo-client.ts', () => ({
  getRepoPatch: mocks.getRepoPatch,
}))

vi.mock('#/web/workspace-external-app-client.ts', () => ({
  openWorkspaceEditor: mocks.openWorkspaceEditor,
  openWorkspaceInFinder: mocks.openWorkspaceInFinder,
  openWorkspaceTerminal: mocks.openWorkspaceTerminal,
}))

vi.mock('#/web/app-shell-client.ts', () => ({
  openExternalUrl: mocks.openExternalUrl,
}))

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-use-branch-actions-test-repo')

describe('useBranchActions', () => {
  beforeEach(() => {
    resetWorkspacesStore()
    mocks.getRepoPatch.mockReset()
    mocks.openWorkspaceEditor.mockReset()
    mocks.openWorkspaceInFinder.mockReset()
    mocks.openWorkspaceTerminal.mockReset()
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
    const branch = createRepoBranch('feature/remote', {
      worktree: { path: '/srv/repo-feature', isPrimary: false, isLocked: false },
    })
    const repo = seedRepoWithReadModelForTest({
      id: target!.id,
      branches: [branch],
      remoteLifecycle: { kind: 'ready', target: target! },
      remote: {
        remotes: [
          {
            name: 'origin',
            fetchUrl: 'https://example.invalid/repository.git',
            pushUrl: 'https://example.invalid/repository.git',
          },
        ],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })
    mocks.openWorkspaceTerminal.mockResolvedValue({ ok: true, message: '' })

    const { result } = renderBranchActions(repoPresentationFromQueryForTest(repo))

    await act(async () => {
      await requiredAction(result.current.actions.openTerminal, 'openTerminal')('ghostty')
    })

    expect(mocks.openWorkspaceTerminal).toHaveBeenCalledWith(
      worktreeTarget(target!.id, repo.workspaceRuntimeId, '/srv/repo-feature'),
      'ghostty',
    )
  })

  test('copyPatch reads the server patch through a mutation and writes it to the clipboard', async () => {
    const branch = createRepoBranch('feature/local', {
      worktree: { path: '/tmp/local-feature', isPrimary: false, isLocked: false },
    })
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

    const { result: hookResult } = renderBranchActions(repoPresentationFromQueryForTest(repo))

    let result = false
    await act(async () => {
      result = await requiredAction(hookResult.current.actions.copyPatch, 'copyPatch')()
    })

    expect(result).toBe(true)
    expect(mocks.getRepoPatch).toHaveBeenCalledWith(REPO_ID, repo.workspaceRuntimeId, '/tmp/local-feature')
    expect(writeText).toHaveBeenCalledWith('diff --git a/file.ts b/file.ts')
  })

  test('fails before reading a patch when the browser cannot copy an asynchronous result', async () => {
    const branch = createRepoBranch('feature/local', {
      worktree: { path: '/tmp/local-feature', isPrimary: false, isLocked: false },
    })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
    })
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Reflect.deleteProperty(navigator, 'clipboard')

    try {
      const { result } = renderBranchActions(repoPresentationFromQueryForTest(repo))

      let copied = true
      await act(async () => {
        copied = await requiredAction(result.current.actions.copyPatch, 'copyPatch')()
      })

      expect(copied).toBe(false)
      expect(mocks.getRepoPatch).not.toHaveBeenCalled()
      expect(
        requireGitWorkspaceClientState(useWorkspacesStore.getState().workspaces[REPO_ID]!).events.at(-1),
      ).toMatchObject({
        kind: 'result',
        result: { ok: false, message: 'status.copy-patch-secure-context-required' },
      })
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
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
    const branch = createRepoBranch('feature/remote', {
      worktree: { path: '/srv/repo-feature', isPrimary: false, isLocked: false },
    })
    const repo = seedRepoWithReadModelForTest({
      id: target!.id,
      branches: [branch],
      remoteLifecycle: { kind: 'ready', target: target! },
      remote: {
        remotes: [
          {
            name: 'origin',
            fetchUrl: 'https://example.invalid/repository.git',
            pushUrl: 'https://example.invalid/repository.git',
          },
        ],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })
    mocks.openWorkspaceEditor.mockResolvedValue({ ok: true, message: '' })

    const { result } = renderBranchActions(repoPresentationFromQueryForTest(repo))

    await act(async () => {
      await requiredAction(result.current.actions.openEditor, 'openEditor')('vscode')
    })

    expect(mocks.openWorkspaceEditor).toHaveBeenCalledWith(
      worktreeTarget(target!.id, repo.workspaceRuntimeId, '/srv/repo-feature'),
      'vscode',
    )
  })

  test('openTerminal uses the embedded server route for non-remote repos', async () => {
    const branch = createRepoBranch('feature/local', {
      worktree: { path: '/tmp/local-feature', isPrimary: false, isLocked: false },
    })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
    })
    mocks.openWorkspaceTerminal.mockResolvedValue({ ok: true, message: '' })

    const { result } = renderBranchActions(repoPresentationFromQueryForTest(repo))

    await act(async () => {
      await requiredAction(result.current.actions.openTerminal, 'openTerminal')('ghostty')
    })

    expect(mocks.openWorkspaceTerminal).toHaveBeenCalledWith(
      worktreeTarget(REPO_ID, repo.workspaceRuntimeId, '/tmp/local-feature'),
      'ghostty',
    )
  })

  test('openEditor forwards an explicit editor app for local repos', async () => {
    const branch = createRepoBranch('feature/local', {
      worktree: { path: '/tmp/local-feature', isPrimary: false, isLocked: false },
    })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
    })
    mocks.openWorkspaceEditor.mockResolvedValue({ ok: true, message: '' })

    const { result } = renderBranchActions(repoPresentationFromQueryForTest(repo))

    await act(async () => {
      await requiredAction(result.current.actions.openEditor, 'openEditor')('vscode')
    })

    expect(mocks.openWorkspaceEditor).toHaveBeenCalledWith(
      worktreeTarget(REPO_ID, repo.workspaceRuntimeId, '/tmp/local-feature'),
      'vscode',
    )
  })

  test('openFinder uses the embedded server route for non-remote repos', async () => {
    const branch = createRepoBranch('feature/local', {
      worktree: { path: '/tmp/local-feature', isPrimary: false, isLocked: false },
    })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
    })
    mocks.openWorkspaceInFinder.mockResolvedValue({ ok: true, message: '/tmp/local-feature' })

    const { result } = renderBranchActions(repoPresentationFromQueryForTest(repo))

    await act(async () => {
      await requiredAction(result.current.actions.openFinder, 'openFinder')()
    })

    expect(mocks.openWorkspaceInFinder).toHaveBeenCalledWith(
      worktreeTarget(REPO_ID, repo.workspaceRuntimeId, '/tmp/local-feature'),
    )
  })

  test('clears local pending state when the branch action target changes', async () => {
    const firstOpen = Promise.withResolvers<ExecResult>()
    const branchA = createRepoBranch('feature/a', {
      worktree: { path: '/tmp/local-feature-a', isPrimary: false, isLocked: false },
    })
    const branchB = createRepoBranch('feature/b', {
      worktree: { path: '/tmp/local-feature-b', isPrimary: false, isLocked: false },
    })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branchA, branchB],
    })
    mocks.openWorkspaceTerminal.mockReturnValue(firstOpen.promise)

    const presentation = repoPresentationFromQueryForTest(repo)
    const view = renderHookInJsdom(
      ({ branchIndex }) => useBranchActions(presentation, presentation.snapshot.branches[branchIndex]!),
      {
        initialProps: { branchIndex: 0 },
        wrapper: AppQueryClientProvider,
      },
    )

    act(() => {
      void requiredAction(view.result.current.actions.openTerminal, 'openTerminal')('ghostty')
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(view.result.current.busyAction).toBe('terminal')
    expect(view.result.current.blocked).toBe(true)

    view.rerender({ branchIndex: 1 })

    expect(view.result.current.busyAction).toBeNull()
    expect(view.result.current.blocked).toBe(false)

    await act(async () => {
      firstOpen.resolve({ ok: true, message: '' })
      await firstOpen.promise
    })
  })
})

function worktreeTarget(workspaceId: WorkspaceId, workspaceRuntimeId: string, worktreePath: string) {
  const target = gitWorktreeFilesystemExecutionTarget(workspaceId, workspaceRuntimeId, worktreePath)
  if (!target) throw new Error('invalid test worktree target')
  return target
}

function renderBranchActions(repo: RepoPresentationForTest) {
  const branch = repo.snapshot.branches[0]!
  return renderHookInJsdom(() => useBranchActions(repo, branch), { wrapper: AppQueryClientProvider })
}

function AppQueryClientProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={appQueryClient}>{children}</QueryClientProvider>
}

function requiredAction<T>(action: T | undefined, name: string): T {
  if (action === undefined) throw new Error(`${name} action unavailable in test fixture`)
  return action
}
