// @vitest-environment jsdom

import { defineComponent, shallowRef } from 'vue'
import { beforeEach, describe, expect, test } from 'vitest'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { RepoServerOperationState } from '#/shared/api-types.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { useBranchActionDialogDisplay } from '#/web/hooks/useBranchActionDialogDisplay.ts'
import type { BranchActionDialogTarget } from '#/web/hooks/useBranchActionDialogDisplay.ts'
import { setRepoOperationsQueryData } from '#/web/repo-query-cache.ts'
import { repoOperationsQueryKey, repoSnapshotQueryKey, repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'
import {
  branchActionDialogsStore,
  resetBranchActionDialogsStore,
} from '#/web/stores/workspaces/branch-action-dialogs.ts'
import type {
  BranchActionDialogEntry,
  RemoveWorktreeDialogPayload,
} from '#/web/stores/workspaces/branch-action-dialogs.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  createRepoBranch,
  repoPresentationFromQueryForTest,
  resetWorkspacesStore,
  seedRepoQueryDataForTest,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/repo-store.ts'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-dialog-display-test')

beforeEach(() => {
  appQueryClient.clear()
  resetWorkspacesStore()
  resetBranchActionDialogsStore()
})

interface HarnessHandle<P> {
  current: ReturnType<typeof useBranchActionDialogDisplay<P>>
  setOpen: (open: boolean) => void
  unmount: () => void
}

function mountHarness<P>(initial: BranchActionDialogEntry<P>): HarnessHandle<P> {
  const target = shallowRef(dialogTarget(initial))
  const open = shallowRef(true)
  let current: ReturnType<typeof useBranchActionDialogDisplay<P>> | null = null
  const Harness = defineComponent({
    name: 'BranchActionDialogDisplayHarness',
    inheritAttrs: false,
    setup() {
      current = useBranchActionDialogDisplay(target, open)
      return () => null
    },
  })
  const view = renderInJsdom(
    <VueQueryClientScope client={appQueryClient}>
      <Harness />
    </VueQueryClientScope>,
  )
  if (!current) throw new Error('dialog display harness did not mount')
  return {
    current,
    setOpen: (next) => {
      open.value = next
    },
    unmount: view.unmount,
  }
}

function dialogTarget<P>(entry: BranchActionDialogEntry<P>): BranchActionDialogTarget<P> {
  const workspace = workspacesStore.getState().workspaces[entry.repoId]
  if (workspace?.capability.kind !== 'git') throw new Error('missing Git dialog workspace')
  return {
    entry,
    repo: {
      id: workspace.id,
      workspaceRuntimeId: workspace.workspaceRuntimeId,
      branchAction: workspace.capability.git.operations.branchAction,
      remoteLifecycle: workspace.admission.kind === 'remote' ? workspace.admission.lifecycle : null,
    },
  }
}

function setupRepo() {
  return seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [
      createRepoBranch('main'),
      createRepoBranch('feature/x', { tracking: 'origin/feature/x', trackingGone: false }),
      createRepoBranch('feature/y', {
        tracking: 'origin/feature/y',
        trackingGone: false,
        worktree: { path: '/tmp/y', isPrimary: false, isLocked: false },
      }),
    ],
    currentBranchName: 'main',
  })
}

async function dropBranch(branchName: string): Promise<void> {
  const repo = workspacesStore.getState().workspaces[REPO_ID]
  if (!repo) throw new Error('missing test repo')
  const readModel = repoPresentationFromQueryForTest(repo)
  await flushTestUpdates(() => {
    seedRepoQueryDataForTest(repo, {
      branches: readModel.snapshot.branches.filter((branch) => branch.name !== branchName),
      currentBranch: readModel.snapshot.current,
      status: readModel.status ?? [],
    })
  })
}

describe('useBranchActionDialogDisplay', () => {
  test('resolves the mounted target and persisted checkbox state from required read models', async () => {
    setupRepo()
    const entry: BranchActionDialogEntry<RemoveWorktreeDialogPayload> = {
      repoId: REPO_ID,
      branchName: 'feature/y',
      payload: { branch: 'feature/y', path: '/tmp/y' },
    }
    branchActionDialogsStore.getState().openRemoveWorktreeConfirm(entry, { isProtectedBranch: false })
    branchActionDialogsStore.getState().setRemoveAlsoUpstream(REPO_ID, 'feature/y', true)

    const handle = mountHarness(entry)

    expect(handle.current.entry).toEqual(entry)
    expect(handle.current.liveContext?.branch.name).toBe('feature/y')
    expect(handle.current.displayContext?.branch.tracking).toBe('origin/feature/y')
    expect(handle.current.displayCheckboxes).toMatchObject({
      removeAlsoDeletes: true,
      removeAlsoUpstream: true,
    })
  })

  test('projects branch action state from server operations', async () => {
    const repo = setupRepo()
    setRepoOperationsQueryData(repo.id, repo.workspaceRuntimeId, false, {
      lastFetchAt: null,
      loadedAt: 123,
      operations: [
        serverOperation({
          workspaceRuntimeId: repo.workspaceRuntimeId,
          kind: 'delete-branch',
          branch: 'feature/x',
        }),
      ],
    })
    const entry: BranchActionDialogEntry<string> = {
      repoId: REPO_ID,
      branchName: 'feature/x',
      payload: 'feature/x',
    }

    const handle = mountHarness(entry)

    expect(handle.current.liveContext?.repo.branchAction).toMatchObject({
      phase: 'running',
      reason: 'branch:deleteBranch',
      target: 'feature/x',
    })
  })

  test('freezes the last resolved display context only after close is accepted', async () => {
    setupRepo()
    const entry: BranchActionDialogEntry<string> = {
      repoId: REPO_ID,
      branchName: 'feature/x',
      payload: 'feature/x',
    }
    const handle = mountHarness(entry)
    expect(handle.current.displayContext?.branch.name).toBe('feature/x')

    await flushTestUpdates(() => handle.setOpen(false))
    await dropBranch('feature/x')

    expect(handle.current.liveContext).toBeNull()
    expect(handle.current.displayContext?.branch.name).toBe('feature/x')
  })

  test('does not hide a missing live branch behind the exit-only retained context', async () => {
    setupRepo()
    const entry: BranchActionDialogEntry<string> = {
      repoId: REPO_ID,
      branchName: 'feature/x',
      payload: 'feature/x',
    }
    const handle = mountHarness(entry)

    await dropBranch('feature/x')

    expect(handle.current.liveContext).toBeNull()
    expect(handle.current.displayContext).toBeNull()
  })

  test('owns exactly one observer per read model and releases them on unmount', async () => {
    const repo = setupRepo()
    const entry: BranchActionDialogEntry<string> = {
      repoId: REPO_ID,
      branchName: 'main',
      payload: 'main',
    }
    const handle = mountHarness(entry)
    const keys = [
      repoSnapshotQueryKey(repo.id, repo.workspaceRuntimeId),
      repoWorktreeStatusQueryKey(repo.id, repo.workspaceRuntimeId),
      repoOperationsQueryKey(repo.id, repo.workspaceRuntimeId),
    ]

    for (const queryKey of keys) {
      expect(appQueryClient.getQueryCache().find({ queryKey })?.getObserversCount()).toBe(1)
    }

    handle.unmount()

    for (const queryKey of keys) {
      expect(appQueryClient.getQueryCache().find({ queryKey })?.getObserversCount()).toBe(0)
    }
  })
})

function serverOperation(
  overrides: Pick<RepoServerOperationState, 'kind'> & { branch: string; workspaceRuntimeId: string },
): RepoServerOperationState {
  return {
    id: `repo-op-${overrides.kind}`,
    repoId: REPO_ID,
    workspaceRuntimeId: overrides.workspaceRuntimeId,
    kind: overrides.kind,
    phase: 'running',
    source: 'user',
    target: { branch: overrides.branch },
    queuedAt: 100,
    startedAt: 101,
    deadlineAt: null,
    settledAt: null,
    error: null,
    cancellation: {
      underlyingRequested: false,
      reason: null,
      requestedAt: null,
      waitCancelledCount: 0,
      lastWaitCancelledAt: null,
      lastWaitCancellationReason: null,
    },
    canCancelUnderlying: true,
  }
}
