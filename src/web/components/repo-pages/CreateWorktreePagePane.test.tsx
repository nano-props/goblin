// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { CreateWorktreePagePane } from '#/web/components/repo-pages/CreateWorktreePagePane.tsx'
import { resetReposStore, seedRepoShellForTest } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { getRepoWorktreeBootstrapPreview } from '#/web/repo-client.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import type { CreateWorktreeRequest } from '#/web/components/create-worktree/create-worktree.logic.ts'
import type { ExecResult } from '#/web/types.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'

const REPO_ID = '/repo'
const REPO_INSTANCE_ID = 'repo-instance-test'

const surfaceMocks = vi.hoisted(() => ({
  createRequest: {
    input: { worktreePath: '/repo-feature', mode: { kind: 'newBranch', newBranch: 'feature/new', baseRef: 'main' } },
  } satisfies CreateWorktreeRequest,
  branchReadModel: { branches: [{ name: 'main' }], currentBranch: 'main', status: [], worktreesByPath: {} } as
    | { branches: Array<{ name: string }>; currentBranch: string; status: never[]; worktreesByPath: Record<string, never> }
    | null,
}))

vi.mock('#/web/components/create-worktree/CreateWorktreeSurface.tsx', () => ({
  CreateWorktreePageBody: ({
    worktreeBootstrap,
    onCreate,
  }: {
    worktreeBootstrap?: { loading: boolean }
    onCreate: (request: CreateWorktreeRequest) => Promise<boolean>
  }) => (
    <button
      type="button"
      data-testid="submit-create-worktree"
      data-loading={worktreeBootstrap?.loading ? 'true' : 'false'}
      onClick={() => {
        void onCreate(surfaceMocks.createRequest)
      }}
    />
  ),
}))

vi.mock('#/web/components/Layout.tsx', () => ({
  ScrollPane: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('#/web/components/workspace-toolbar-chrome.tsx', () => ({
  WorkspaceToolbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  WorkspaceToolbarContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  WorkspaceToolbarLeadingSpacer: () => null,
  WorkspaceToolbarPrimary: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('#/web/repo-branch-read-model.ts', () => ({
  useRepoBranchReadModel: () => surfaceMocks.branchReadModel,
}))

vi.mock('#/web/repo-client.ts', () => ({
  getRepoWorktreeBootstrapPreview: vi.fn(async () => ({ ok: false, message: 'error.failed-read-repo' })),
}))

beforeEach(() => {
  vi.clearAllMocks()
  primaryWindowQueryClient.clear()
  resetReposStore()
  surfaceMocks.branchReadModel = { branches: [{ name: 'main' }], currentBranch: 'main', status: [], worktreesByPath: {} }
  vi.mocked(getRepoWorktreeBootstrapPreview).mockImplementation(async () => ({ ok: false, message: 'error.failed-read-repo' }))
  primaryWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot({ repoSettings: [] }))
  seedRepoShellForTest({ id: REPO_ID, instanceId: REPO_INSTANCE_ID })
})

function renderPane(element: ReactElement) {
  return renderInJsdom(<QueryClientProvider client={primaryWindowQueryClient}>{element}</QueryClientProvider>)
}

describe('CreateWorktreePagePane', () => {
  test('keeps stable page chrome while branch data is loading', () => {
    surfaceMocks.branchReadModel = null

    const { container } = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    expect(container.textContent).toContain('action.create-worktree-title')
    expect(container.querySelector('[data-testid="repo-page-loading"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="submit-create-worktree"]')).toBeNull()
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

    expect(container.querySelector('[data-testid="repo-page-loading"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="submit-create-worktree"]')).toBeNull()

    resolvePreview({ ok: false, message: 'error.failed-read-repo' })
    await waitFor(() => {
      expect(container.querySelector('[data-testid="repo-page-loading"]')).toBeNull()
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
      expect(container.querySelector('[data-testid="repo-page-loading"]')).toBeNull()
    })
    expect(container.querySelector('[data-testid="submit-create-worktree"]')).not.toBeNull()
  })

  test('waits for the full bootstrap load before showing the form', async () => {
    let resolvePreview!: (value: {
      ok: true,
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

    await act(async () => {
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
      expect(container.querySelector('[data-testid="repo-page-loading"]')).toBeNull()
      expect(button(container).dataset.loading).toBe('false')
    })
  })

  test('releases the form when settings fails after a trust-relevant bootstrap preview', async () => {
    primaryWindowQueryClient.clear()
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
      expect(container.querySelector('[data-testid="repo-page-loading"]')).toBeNull()
    })
    expect(container.querySelector('[data-testid="submit-create-worktree"]')).not.toBeNull()
  })

  test('navigates to the created branch after the action succeeds', async () => {
    const onCreated = vi.fn()
    const onCancel = vi.fn()
    let resolveAction!: (value: ExecResult) => void
    useReposStore.setState({
      runBranchAction: vi.fn(
        () =>
          new Promise<ExecResult>((resolve) => {
            resolveAction = resolve
          }),
      ),
    })

    const { container } = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={onCancel} onCreated={onCreated} />)

    await waitFor(() => {
      expect(button(container).dataset.loading).toBe('false')
    })

    await act(async () => {
      button(container).click()
    })

    expect(onCreated).not.toHaveBeenCalled()

    await act(async () => {
      resolveAction({ ok: true, message: 'ok' })
    })

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('feature/new')
    })
    expect(onCancel).not.toHaveBeenCalled()
  })

  test('does not reload bootstrap preview when the repo presentation refreshes', async () => {
    const { rerender } = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    await waitFor(() => {
      expect(getRepoWorktreeBootstrapPreview).toHaveBeenCalledTimes(1)
    })

    const repo = useReposStore.getState().repos[REPO_ID]
    useReposStore.setState({ repos: { [REPO_ID]: { ...repo } } })
    rerender(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(getRepoWorktreeBootstrapPreview).toHaveBeenCalledTimes(1)
  })

  test('stays on the form when the action fails', async () => {
    const onCreated = vi.fn()
    useReposStore.setState({ runBranchAction: vi.fn(async () => ({ ok: false, message: 'error.invalid-path' })) })

    const { container } = renderPane(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={onCreated} />)

    await waitFor(() => {
      expect(button(container).dataset.loading).toBe('false')
    })

    await act(async () => {
      button(container).click()
    })

    await waitFor(() => {
      expect(useReposStore.getState().runBranchAction).toHaveBeenCalled()
    })
    expect(onCreated).not.toHaveBeenCalled()
  })
})

function button(container: HTMLElement): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>('[data-testid="submit-create-worktree"]')
  if (!element) throw new Error('missing submit button')
  return element
}
