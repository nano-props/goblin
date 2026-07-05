// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, waitFor } from '@testing-library/react'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { CreateWorktreePagePane } from '#/web/components/repo-pages/CreateWorktreePagePane.tsx'
import { resetReposStore, seedRepoShellForTest } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { CreateWorktreeRequest } from '#/web/components/create-worktree/create-worktree.logic.ts'

const surfaceMocks = vi.hoisted(() => ({
  createRequest: {
    input: { worktreePath: '/repo-feature', mode: { kind: 'newBranch', newBranch: 'feature/new', baseRef: 'main' } },
  } satisfies CreateWorktreeRequest,
}))

vi.mock('#/web/components/create-worktree/CreateWorktreeSurface.tsx', () => ({
  CreateWorktreePageSurface: ({
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
  useRepoBranchReadModel: () => ({ branches: [{ name: 'main' }], currentBranch: 'main', status: [], worktreesByPath: {} }),
}))

vi.mock('#/web/settings-queries.ts', () => ({
  useSettingsSnapshotReadModel: () => ({ repoSettings: [] }),
}))

vi.mock('#/web/repo-client.ts', () => ({
  getRepoWorktreeBootstrapPreview: vi.fn(async () => ({ ok: false })),
}))

const REPO_ID = '/repo'

beforeEach(() => {
  resetReposStore()
  seedRepoShellForTest({ id: REPO_ID })
})

describe('CreateWorktreePagePane', () => {
  test('navigates to the created branch after the action succeeds', async () => {
    const onCreated = vi.fn()
    useReposStore.setState({ runBranchAction: vi.fn(async () => ({ ok: true, message: 'ok' })) })

    const { container } = renderInJsdom(<CreateWorktreePagePane repoId={REPO_ID} onCancel={vi.fn()} onCreated={onCreated} />)

    await waitFor(() => {
      expect(button(container).dataset.loading).toBe('false')
    })

    await act(async () => {
      button(container).click()
    })

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('feature/new')
    })
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
