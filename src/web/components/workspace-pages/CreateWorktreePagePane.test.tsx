// @vitest-environment jsdom

import { createRepoBranch, seedRepoWithReadModelForTest, resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { waitFor } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import type { FunctionalComponent, VNode, VNodeChild } from 'vue'
import { flushMicrotasks, waitForMicrotaskCondition } from '#/test-utils/microtasks.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { advanceTimersAndFlush, useFakeTimers } from '#/test-utils/timers.ts'
import { CreateWorktreePagePane } from '#/web/components/workspace-pages/CreateWorktreePagePane.tsx'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { getRepoOperations, getRepoSnapshot, getRepoWorktreeBootstrapPreview } from '#/web/repo-client.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import type { CreateWorktreeRequest } from '#/web/components/create-worktree/create-worktree.logic.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type { RepoSnapshotResponse } from '#/shared/api-types.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { getSettingsSnapshot } from '#/web/settings-client.ts'
import { DEFAULT_LOADING_DELAY_MS, DEFAULT_MIN_LOADING_VISIBLE_MS } from '#/web/hooks/useLoadingVisibility.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { repoSnapshotQueryKey, repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'
import {
  beginAppNavigation,
  currentAppNavigationGeneration,
  resetAppNavigationForTest,
} from '#/web/app-navigation-lifecycle.ts'
import { repoOperationsForTest } from '#/web/test-utils/repo-query-runtime.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///workspace')
const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'

const surfaceMocks = vi.hoisted(() => ({
  createRequest: {
    input: { worktreePath: '/repo-feature', mode: { kind: 'newBranch', newBranch: 'feature/new', baseRef: 'main' } },
  } satisfies CreateWorktreeRequest,
}))

vi.mock('#/web/settings-client.ts', () => ({ getSettingsSnapshot: vi.fn() }))

const mockedGetSettingsSnapshot = vi.mocked(getSettingsSnapshot)

vi.mock('#/web/components/create-worktree/CreateWorktreeSurface.tsx', () => {
  const CreateWorktreePageBody: FunctionalComponent<{
    worktreeBootstrap?: { loading: boolean }
    onCreate: (request: CreateWorktreeRequest) => Promise<boolean>
  }> = ({ worktreeBootstrap, onCreate }) => (
    <button
      type="button"
      data-testid="submit-create-worktree"
      data-loading={worktreeBootstrap?.loading ? 'true' : 'false'}
      onClick={() => {
        void onCreate(surfaceMocks.createRequest)
      }}
    />
  )
  CreateWorktreePageBody.props = ['worktreeBootstrap', 'onCreate']
  return { CreateWorktreePageBody }
})

vi.mock('#/web/components/Layout.tsx', () => {
  const ScrollPane: FunctionalComponent = (_props, { slots }) => <div>{slots.default?.()}</div>
  const EmptyState: FunctionalComponent<{ title: VNodeChild; body?: VNodeChild }> = (props) => (
    <div>
      <div>{props.title}</div>
      {props.body ? <div>{props.body}</div> : null}
    </div>
  )
  EmptyState.props = ['title', 'body']
  return { EmptyState, ScrollPane }
})

vi.mock('#/web/components/workspace-toolbar-chrome.tsx', () => {
  const SlotWrapper: FunctionalComponent = (_props, { slots }) => <div>{slots.default?.()}</div>
  const WorkspaceToolbarLeadingSpacer: FunctionalComponent = () => <span />
  return {
    WorkspaceToolbar: SlotWrapper,
    WorkspaceToolbarContent: SlotWrapper,
    WorkspaceToolbarLeadingSpacer,
    WorkspaceToolbarPrimary: SlotWrapper,
  }
})

vi.mock('#/web/repo-client.ts', () => ({
  getRepoSnapshot: vi.fn(),
  getRepoWorktreeBootstrapPreview: vi.fn(async () => ({ ok: false, message: 'error.failed-read-repo' })),
  getRepoOperations: vi.fn(),
}))

const mockedGetRepoSnapshot = vi.mocked(getRepoSnapshot)
const mockedGetRepoOperations = vi.mocked(getRepoOperations)

beforeEach(() => {
  resetAppNavigationForTest()
  vi.clearAllMocks()
  appQueryClient.clear()
  resetWorkspacesStore()
  vi.mocked(getRepoWorktreeBootstrapPreview).mockImplementation(async () => ({
    ok: false,
    message: 'error.failed-read-repo',
  }))
  mockedGetRepoSnapshot.mockReset()
  mockedGetRepoSnapshot.mockImplementation(() => new Promise(() => {}))
  mockedGetRepoOperations.mockReset()
  mockedGetRepoOperations.mockResolvedValue(repoOperationsForTest(0))
  mockedGetSettingsSnapshot.mockReset()
  mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot({ workspaceSettings: [] }))
  appQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot({ workspaceSettings: [] }))
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    branches: [createRepoBranch('main')],
    currentBranchName: 'main',
  })
})

afterEach(() => {
  vi.useRealTimers()
})

function renderPane(element: VNode) {
  return renderInJsdom(<VueQueryClientScope client={appQueryClient}>{element}</VueQueryClientScope>)
}

describe('CreateWorktreePagePane', () => {
  test('does not start a worktree-status query for the create form', async () => {
    appQueryClient.removeQueries({
      queryKey: repoWorktreeStatusQueryKey(REPO_ID, WORKSPACE_RUNTIME_ID),
      exact: true,
    })

    const { container } = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    await waitFor(() => expect(container.querySelector('[data-testid="submit-create-worktree"]')).not.toBeNull())
    expect(
      appQueryClient.getQueryCache().find({
        queryKey: repoWorktreeStatusQueryKey(REPO_ID, WORKSPACE_RUNTIME_ID),
        exact: true,
      }),
    ).toBeUndefined()
  })

  test('keeps the accepted snapshot visible when its background refresh fails', async () => {
    const snapshotQuery = appQueryClient.getQueryCache().find({
      queryKey: repoSnapshotQueryKey(REPO_ID, WORKSPACE_RUNTIME_ID),
      exact: true,
    })
    if (!snapshotQuery) throw new Error('missing snapshot query')
    snapshotQuery.setState({ ...snapshotQuery.state, status: 'error', error: new Error('snapshot refresh failed') })

    const { container } = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    await waitFor(() => expect(container.querySelector('[data-testid="submit-create-worktree"]')).not.toBeNull())
    expect(container.textContent).toContain('status.stale-title')
    expect(container.textContent).toContain('snapshot refresh failed')
  })

  test('keeps the create form with a neutral retry when a snapshot read crosses a membership change', async () => {
    const snapshotQueryKey = repoSnapshotQueryKey(REPO_ID, WORKSPACE_RUNTIME_ID)
    const snapshotQuery = appQueryClient.getQueryCache().find({
      queryKey: snapshotQueryKey,
      exact: true,
    })
    const acceptedSnapshot = appQueryClient.getQueryData<RepoSnapshotResponse>(snapshotQueryKey)
    if (!snapshotQuery || !acceptedSnapshot) throw new Error('missing snapshot query data')
    mockedGetRepoSnapshot.mockRejectedValue(new Error('error.repo-membership-changing'))
    snapshotQuery.setState({
      ...snapshotQuery.state,
      status: 'error',
      error: new Error('error.repo-membership-changing'),
    })

    const { container } = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    await waitFor(() => expect(container.querySelector('[data-testid="submit-create-worktree"]')).not.toBeNull())
    await waitFor(() => expect(container.textContent).toContain('error.repo-membership-changing'))
    expect(container.textContent).not.toContain('status.stale-title')
    const retry = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'error.try-again',
    )
    if (!retry) throw new Error('missing membership retry')

    mockedGetRepoSnapshot.mockResolvedValue(acceptedSnapshot)
    await flushTestUpdates(async () => retry.click())

    await waitFor(() => expect(mockedGetRepoSnapshot).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).not.toContain('error.repo-membership-changing'))
    expect(container.querySelector('[data-testid="submit-create-worktree"]')).not.toBeNull()
    expect(container.textContent).not.toContain('status.stale-title')
  })

  test('keeps stable page chrome while branch data is loading', () => {
    appQueryClient.removeQueries({ queryKey: repoSnapshotQueryKey(REPO_ID, WORKSPACE_RUNTIME_ID) })

    const { container } = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    expect(container.textContent).toContain('action.create-worktree-title')
    expect(container.querySelector('[data-testid="workspace-page-quiet-loading"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workspace-page-loading"]')).toBeNull()
    expect(container.querySelector('[data-testid="submit-create-worktree"]')).toBeNull()
  })

  test('delays the bootstrap skeleton until loading lasts long enough', async () => {
    useFakeTimers()
    let resolvePreview!: (value: { ok: false; message: string }) => void
    vi.mocked(getRepoWorktreeBootstrapPreview).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve
        }),
    )

    const { container } = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    expect(container.textContent).toContain('action.create-worktree-title')
    expect(container.querySelector('[data-testid="workspace-page-quiet-loading"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workspace-page-loading"]')).toBeNull()
    expect(container.querySelector('[data-testid="submit-create-worktree"]')).toBeNull()

    await advanceVueTimers(DEFAULT_LOADING_DELAY_MS)

    expect(container.querySelector('[data-testid="workspace-page-quiet-loading"]')).toBeNull()
    expect(container.querySelector('[data-testid="workspace-page-loading"]')).not.toBeNull()

    await flushTestUpdates(async () => {
      resolvePreview({ ok: false, message: 'error.failed-read-repo' })
      await flushMicrotasks(5)
    })

    expect(container.querySelector('[data-testid="workspace-page-loading"]')).not.toBeNull()

    await advanceVueTimers(DEFAULT_MIN_LOADING_VISIBLE_MS)

    expect(container.querySelector('[data-testid="workspace-page-loading"]')).toBeNull()
    expect(container.querySelector('[data-testid="submit-create-worktree"]')).not.toBeNull()
  })

  test('skips the skeleton when bootstrap finishes before the loading delay', async () => {
    useFakeTimers()
    let resolvePreview!: (value: { ok: false; message: string }) => void
    vi.mocked(getRepoWorktreeBootstrapPreview).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve
        }),
    )

    const { container } = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    expect(container.querySelector('[data-testid="workspace-page-quiet-loading"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workspace-page-loading"]')).toBeNull()

    await flushTestUpdates(async () => {
      resolvePreview({ ok: false, message: 'error.failed-read-repo' })
      await flushMicrotasks(5)
    })
    await waitForMicrotaskCondition(() => container.querySelector('[data-testid="submit-create-worktree"]') !== null)

    expect(container.querySelector('[data-testid="submit-create-worktree"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workspace-page-loading"]')).toBeNull()

    await advanceVueTimers(DEFAULT_LOADING_DELAY_MS)

    expect(container.querySelector('[data-testid="submit-create-worktree"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workspace-page-loading"]')).toBeNull()
  })

  test('keeps stable page chrome while the bootstrap load is still pending', async () => {
    let resolvePreview!: (value: { ok: false; message: string }) => void
    vi.mocked(getRepoWorktreeBootstrapPreview).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve
        }),
    )

    const { container } = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    expect(container.textContent).toContain('action.create-worktree-title')
    expect(container.querySelector('[data-testid="submit-create-worktree"]')).toBeNull()

    await flushTestUpdates(async () => {
      resolvePreview({ ok: false, message: 'error.failed-read-repo' })
    })
    await waitFor(() => {
      expect(container.querySelector('[data-testid="submit-create-worktree"]')).not.toBeNull()
    })
  })

  test('shows the form without settings when the bootstrap preview has no runnable config', async () => {
    vi.mocked(getRepoWorktreeBootstrapPreview).mockResolvedValueOnce({
      ok: true,
      preview: {
        hasConfig: false,
        hasOperations: false,
        configHash: null,
        copyCount: 0,
        symlinkCount: 0,
        hardlinkCount: 0,
        excludeCount: 0,
      },
    })

    const { container } = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    await waitFor(() => {
      expect(container.querySelector('[data-testid="submit-create-worktree"]')).not.toBeNull()
    })
  })

  test('waits for the full bootstrap load before showing the form', async () => {
    let resolvePreview!: (value: {
      ok: true
      preview: {
        hasConfig: boolean
        hasOperations: boolean
        configHash: string
        copyCount: number
        symlinkCount: number
        hardlinkCount: number
        excludeCount: number
      }
    }) => void
    vi.mocked(getRepoWorktreeBootstrapPreview).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve
        }),
    )

    const { container } = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    await flushTestUpdates(async () => {
      resolvePreview({
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
      })
    })

    await waitFor(() => {
      expect(container.querySelector('[data-testid="workspace-page-loading"]')).toBeNull()
      expect(button(container).dataset.loading).toBe('false')
    })
  })

  test('reuses a pending settings query after the first consumer unmounts', async () => {
    appQueryClient.removeQueries({ queryKey: settingsSnapshotQueryKey(), exact: true })
    const settings = Promise.withResolvers<ReturnType<typeof defaultSettingsSnapshot>>()
    let querySignal: AbortSignal | undefined
    mockedGetSettingsSnapshot.mockImplementation((options: { signal?: AbortSignal } = {}) => {
      querySignal = options.signal
      return settings.promise
    })
    vi.mocked(getRepoWorktreeBootstrapPreview).mockResolvedValue({
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
    })

    const first = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)
    await waitFor(() => expect(mockedGetSettingsSnapshot).toHaveBeenCalledOnce())
    first.unmount()

    const second = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)
    await flushMicrotasks(2)
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledOnce()
    expect(querySignal?.aborted).toBe(false)

    settings.resolve(defaultSettingsSnapshot({ workspaceSettings: [] }))
    await waitFor(() => expect(second.container.querySelector('[data-testid="submit-create-worktree"]')).not.toBeNull())
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledOnce()
  })

  test('releases the form when settings fails after a trust-relevant bootstrap preview', async () => {
    appQueryClient.removeQueries({ queryKey: settingsSnapshotQueryKey(), exact: true })
    mockedGetSettingsSnapshot.mockRejectedValueOnce(new Error('settings unavailable'))
    vi.mocked(getRepoWorktreeBootstrapPreview).mockResolvedValueOnce({
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
    })

    const { container } = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    await waitFor(() => {
      expect(container.querySelector('[data-testid="submit-create-worktree"]')).not.toBeNull()
    })
  })

  test('navigates to the created branch after the action succeeds', async () => {
    const onCreated = vi.fn()
    const onCancel = vi.fn()
    let resolveAction!: (value: ExecResult) => void
    workspacesStore.setState({
      runBranchAction: vi.fn(
        () =>
          new Promise<ExecResult>((resolve) => {
            resolveAction = resolve
          }),
      ),
    })

    const { container } = renderPane(
      <CreateWorktreePagePane repoId={REPO_ID} onCancel={onCancel} onCreated={onCreated} />,
    )

    await waitFor(() => {
      expect(button(container).dataset.loading).toBe('false')
    })

    const generationBeforeSubmit = currentAppNavigationGeneration()
    await flushTestUpdates(async () => {
      button(container).click()
    })
    const navigationGeneration = currentAppNavigationGeneration()
    expect(navigationGeneration).toBeGreaterThan(generationBeforeSubmit)

    expect(onCreated).not.toHaveBeenCalled()

    await flushTestUpdates(async () => {
      resolveAction({ ok: true, message: 'ok' })
    })

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('feature/new', navigationGeneration)
    })
    expect(onCancel).not.toHaveBeenCalled()
  })

  test('retains the submitting navigation generation when creation settles after newer navigation', async () => {
    const admittedOnCreated = vi.fn()
    const replacementOnCreated = vi.fn()
    let resolveAction!: (value: ExecResult) => void
    workspacesStore.setState({
      runBranchAction: vi.fn(
        () =>
          new Promise<ExecResult>((resolve) => {
            resolveAction = resolve
          }),
      ),
    })
    const { container, rerender } = renderPane(
      <CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={admittedOnCreated} />,
    )
    await waitFor(() => expect(button(container).dataset.loading).toBe('false'))

    await flushTestUpdates(async () => {
      button(container).click()
    })
    const submittingGeneration = currentAppNavigationGeneration()
    beginAppNavigation()
    await rerender(
      <VueQueryClientScope client={appQueryClient}>
        <CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={replacementOnCreated} />
      </VueQueryClientScope>,
    )
    await flushTestUpdates(async () => {
      resolveAction({ ok: true, message: 'ok' })
    })

    await waitFor(() => expect(admittedOnCreated).toHaveBeenCalledWith('feature/new', submittingGeneration))
    expect(replacementOnCreated).not.toHaveBeenCalled()
  })

  test('does not reload bootstrap preview when the repo presentation refreshes', async () => {
    const { rerender } = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    await waitFor(() => {
      expect(getRepoWorktreeBootstrapPreview).toHaveBeenCalledTimes(1)
    })

    const repo = workspacesStore.getState().workspaces[REPO_ID]
    workspacesStore.setState({ workspaces: { [REPO_ID]: { ...repo } } })
    await rerender(
      <VueQueryClientScope client={appQueryClient}>
        <CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />
      </VueQueryClientScope>,
    )

    expect(getRepoWorktreeBootstrapPreview).toHaveBeenCalledTimes(1)
  })

  test('shares the bootstrap preview read across an interrupted mount', async () => {
    const preview = Promise.withResolvers<{
      ok: false
      message: string
    }>()
    vi.mocked(getRepoWorktreeBootstrapPreview).mockReturnValue(preview.promise)

    const firstMount = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)
    await waitFor(() => expect(getRepoWorktreeBootstrapPreview).toHaveBeenCalledOnce())
    firstMount.unmount()
    const { container } = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    await flushTestUpdates(async () => preview.resolve({ ok: false, message: 'error.failed-read-repo' }))
    await waitFor(() => expect(container.querySelector('[data-testid="submit-create-worktree"]')).not.toBeNull())
    expect(getRepoWorktreeBootstrapPreview).toHaveBeenCalledOnce()
  })

  test('stays on the form when the action fails', async () => {
    const onCreated = vi.fn()
    workspacesStore.setState({ runBranchAction: vi.fn(async () => ({ ok: false, message: 'error.invalid-path' })) })

    const { container } = renderPane(
      <CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={onCreated} />,
    )

    await waitFor(() => {
      expect(button(container).dataset.loading).toBe('false')
    })

    await flushTestUpdates(async () => {
      button(container).click()
    })

    await waitFor(() => {
      expect(workspacesStore.getState().runBranchAction).toHaveBeenCalled()
    })
    expect(onCreated).not.toHaveBeenCalled()
  })
})

async function advanceVueTimers(ms: number): Promise<void> {
  await flushTestUpdates(async () => {
    await advanceTimersAndFlush(ms)
  })
}

function button(container: HTMLElement): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>('[data-testid="submit-create-worktree"]')
  if (!element) throw new Error('missing submit button')
  return element
}
