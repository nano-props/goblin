// @vitest-environment jsdom

import {
  repoPresentationFromQueryForTest,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  createRepoBranch,
} from '#/web/test-utils/repo-store.ts'
import type { RepoPresentationForTest } from '#/web/test-utils/repo-store.ts'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { useBranchActions } from '#/web/hooks/useBranchActions.tsx'
import { normalizeRemoteTarget } from '#/shared/remote-workspace.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import { gitWorktreeFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { requireGitWorkspaceClientState } from '#/web/stores/workspaces/git-workspace-client-state.ts'
import { renderComposableInJsdom } from '#/test-utils/render.tsx'
import { CodedError } from '#/shared/coded-error.ts'

const mocks = vi.hoisted(() => ({
  getRepoPatch: vi.fn(),
  openWorkspaceEditor: vi.fn(),
  openWorkspaceInFinder: vi.fn(),
  openWorkspaceTerminal: vi.fn(),
  openRepoUrl: vi.fn(),
  openExternalUrl: vi.fn(),
  toastWarning: vi.fn(),
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

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), warning: mocks.toastWarning },
}))

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-use-branch-actions-test-repo')

describe('useBranchActions', () => {
  beforeEach(() => {
    resetWorkspacesStore()
    mocks.getRepoPatch.mockReset()
    mocks.openWorkspaceEditor.mockReset()
    mocks.openWorkspaceInFinder.mockReset()
    mocks.openWorkspaceTerminal.mockReset()
    mocks.toastWarning.mockReset()
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

    await flushTestUpdates(async () => {
      await requiredAction(result.value.actions.openTerminal, 'openTerminal')('ghostty')
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
    await flushTestUpdates(async () => {
      result = await requiredAction(hookResult.value.actions.copyPatch, 'copyPatch')()
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
      await flushTestUpdates(async () => {
        copied = await requiredAction(result.value.actions.copyPatch, 'copyPatch')()
      })

      expect(copied).toBe(false)
      expect(mocks.getRepoPatch).not.toHaveBeenCalled()
      expect(
        requireGitWorkspaceClientState(workspacesStore.getState().workspaces[REPO_ID]!).events.at(-1),
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

    await flushTestUpdates(async () => {
      await requiredAction(result.value.actions.openEditor, 'openEditor')('vscode')
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

    await flushTestUpdates(async () => {
      await requiredAction(result.value.actions.openTerminal, 'openTerminal')('ghostty')
    })

    expect(mocks.openWorkspaceTerminal).toHaveBeenCalledWith(
      worktreeTarget(REPO_ID, repo.workspaceRuntimeId, '/tmp/local-feature'),
      'ghostty',
    )
  })

  test('reports an uncertain external app outcome as a warning without queuing an ordinary failure', async () => {
    const branch = createRepoBranch('feature/local', {
      worktree: { path: '/tmp/local-feature', isPrimary: false, isLocked: false },
    })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
    })
    mocks.openWorkspaceTerminal.mockRejectedValue(
      new CodedError({ code: 'OUTCOME_UNCERTAIN', message: 'response lost' }),
    )

    const { result } = renderBranchActions(repoPresentationFromQueryForTest(repo))

    await flushTestUpdates(async () => {
      await requiredAction(result.value.actions.openTerminal, 'openTerminal')('ghostty')
    })

    expect(mocks.toastWarning).toHaveBeenCalledWith('error.external-app-outcome-uncertain')
    expect(requireGitWorkspaceClientState(workspacesStore.getState().workspaces[REPO_ID]!).events).toEqual([])
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

    await flushTestUpdates(async () => {
      await requiredAction(result.value.actions.openEditor, 'openEditor')('vscode')
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

    await flushTestUpdates(async () => {
      await requiredAction(result.value.actions.openFinder, 'openFinder')()
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
    const branchIndex = ref(0)
    const view = renderComposableInJsdom(
      () => useBranchActions(presentation, () => presentation.snapshot.branches[branchIndex.value]!),
      { wrapper: AppVueQueryClientScope },
    )

    await flushTestUpdates(() => {
      void requiredAction(view.result.value.actions.openTerminal, 'openTerminal')('ghostty')
    })
    await flushTestUpdates(async () => {
      await Promise.resolve()
    })

    expect(view.result.value.busyAction).toBe('terminal')
    expect(view.result.value.blocked).toBe(true)

    await flushTestUpdates(() => {
      branchIndex.value = 1
    })

    expect(view.result.value.busyAction).toBeNull()
    expect(view.result.value.blocked).toBe(false)

    await flushTestUpdates(async () => {
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
  return renderComposableInJsdom(() => useBranchActions(repo, branch), { wrapper: AppVueQueryClientScope })
}

const AppVueQueryClientScope = defineComponent({
  name: 'AppVueQueryClientScope',
  setup(_props, { slots }) {
    return () => <VueQueryClientScope client={appQueryClient}>{slots.default?.()}</VueQueryClientScope>
  },
})

function requiredAction<T>(action: T | undefined, name: string): T {
  if (action === undefined) throw new Error(`${name} action unavailable in test fixture`)
  return action
}
