// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, waitFor } from '@testing-library/react'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { CreateWorktreePagePane } from '#/web/components/repo-pages/CreateWorktreePagePane.tsx'
import { resetReposStore, seedRepoShellForTest } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { getRepoWorktreeBootstrapPreview } from '#/web/repo-client.ts'
import type { CreateWorktreeRequest } from '#/web/components/create-worktree/create-worktree.logic.ts'

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

vi.mock('#/web/settings-queries.ts', () => ({
  useSettingsSnapshotReadModel: () => ({ repoSettings: [] }),
}))

vi.mock('#/web/repo-client.ts', () => ({
  getRepoWorktreeBootstrapPreview: vi.fn(async () => ({ ok: false })),
}))

const REPO_ID = '/repo'

beforeEach(() => {
  vi.clearAllMocks()
  resetReposStore()
  surfaceMocks.branchReadModel = { branches: [{ name: 'main' }], currentBranch: 'main', status: [], worktreesByPath: {} }
  seedRepoShellForTest({ id: REPO_ID })
})

describe('CreateWorktreePagePane', () => {
  test('keeps stable page chrome while branch data is loading', () => {
    surfaceMocks.branchReadModel = null

    const { container } = renderInJsdom(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    expect(container.textContent).toContain('action.create-worktree-title')
    expect(container.querySelector('[data-testid="repo-page-loading"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="submit-create-worktree"]')).toBeNull()
  })

  test('keeps stable page chrome while the bootstrap preview is still loading', async () => {
    // Reset the implementation locally so this test does not rely on the
    // project-level vitest `mockReset` setting to scrub earlier tests.
    vi.mocked(getRepoWorktreeBootstrapPreview).mockReset()
    let resolvePreview!: (value: { ok: false; message: string }) => void
    vi.mocked(getRepoWorktreeBootstrapPreview).mockImplementation(
      () =>
        new Promise<{ ok: false; message: string }>((resolve) => {
          resolvePreview = resolve
        }),
    )

    const { container } = renderInJsdom(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    // form is still loading because the preview request hasn't resolved yet
    expect(container.querySelector('[data-testid="repo-page-loading"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="submit-create-worktree"]')).toBeNull()

    // letting the preview resolve (with ok=false, an error result) releases the gate
    resolvePreview({ ok: false, message: 'error.failed-read-repo' })
    await waitFor(() => {
      expect(container.querySelector('[data-testid="repo-page-loading"]')).toBeNull()
    })
    expect(container.querySelector('[data-testid="submit-create-worktree"]')).not.toBeNull()
  })

  test('navigates to the created branch after the action succeeds', async () => {
    const onCreated = vi.fn()
    const onCancel = vi.fn()
    useReposStore.setState({ runBranchAction: vi.fn(async () => ({ ok: true, message: 'ok' })) })

    const { container } = renderInJsdom(<CreateWorktreePagePane repoId={REPO_ID} onCancel={onCancel} onCreated={onCreated} />)

    await waitFor(() => {
      expect(button(container).dataset.loading).toBe('false')
    })

    await act(async () => {
      button(container).click()
    })

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('feature/new')
    })
    expect(onCancel).not.toHaveBeenCalled()
  })

  test('does not reload bootstrap preview when the repo presentation refreshes', async () => {
    const { rerender } = renderInJsdom(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    await waitFor(() => {
      expect(getRepoWorktreeBootstrapPreview).toHaveBeenCalledTimes(1)
    })

    const repo = useReposStore.getState().repos[REPO_ID]
    useReposStore.setState({ repos: { [REPO_ID]: { ...repo } } })
    rerender(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={vi.fn()} />)

    expect(getRepoWorktreeBootstrapPreview).toHaveBeenCalledTimes(1)
  })

  test('stays on the form when the action fails', async () => {
    const onCreated = vi.fn()
    useReposStore.setState({ runBranchAction: vi.fn(async () => ({ ok: false, message: 'error.invalid-path' })) })

    const { container } = renderInJsdom(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={onCreated} />)

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
