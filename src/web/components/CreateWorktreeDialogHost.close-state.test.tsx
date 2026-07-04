// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { CreateWorktreeDialogHost } from '#/web/components/CreateWorktreeDialogHost.tsx'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore, seedRepoShellForTest } from '#/web/test-utils/bridge.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'

vi.mock('#/web/components/create-worktree-dialog/CreateWorktreeDialog.tsx', () => ({
  CreateWorktreeDialog: ({ open, repo }: { open: boolean; repo: { id: string } }) => (
    <div data-testid="create-worktree-dialog" data-open={String(open)} data-repo-id={repo.id} />
  ),
}))

const REPO_ID = '/tmp/create-worktree-host-close-state'
const OTHER_REPO_ID = '/tmp/create-worktree-host-other-active'

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
  primaryWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot())
  seedRepoShellForTest({
    id: REPO_ID,
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true, preview: { hasOperations: false } }))),
  )
})

afterEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CreateWorktreeDialogHost close state', () => {
  test('keeps the dialog mounted when closing so Radix can run exit motion', () => {
    const onOpenChange = vi.fn()
    const { container, rerender } = renderInJsdom(
      hostElement(true, onOpenChange, REPO_ID),
    )

    expect(dialog(container)?.getAttribute('data-open')).toBe('true')
    expect(dialog(container)?.getAttribute('data-repo-id')).toBe(REPO_ID)

    rerender(hostElement(false, onOpenChange, REPO_ID))

    expect(dialog(container)?.getAttribute('data-open')).toBe('false')
    expect(dialog(container)?.getAttribute('data-repo-id')).toBe(REPO_ID)
  })

  test('uses the supplied repo session target instead of live active repo state', () => {
    const repo = seedRepoShellForTest({
      id: REPO_ID,
    })
    seedRepoShellForTest({
      id: OTHER_REPO_ID,
    })
    act(() => {
      useReposStore.setState((state) => ({
        repos: { ...state.repos, [REPO_ID]: repo },
        order: [OTHER_REPO_ID, REPO_ID],
        activeId: OTHER_REPO_ID,
      }))
    })
    const onOpenChange = vi.fn()
    const { container } = renderInJsdom(hostElement(true, onOpenChange, REPO_ID))

    expect(dialog(container)?.getAttribute('data-open')).toBe('true')
    expect(dialog(container)?.getAttribute('data-repo-id')).toBe(REPO_ID)
  })

  test('retains the last repo snapshot if the repo is removed before the close animation finishes', () => {
    const onOpenChange = vi.fn()
    const { container, rerender } = renderInJsdom(
      hostElement(true, onOpenChange, REPO_ID),
    )

    act(() => {
      useReposStore.setState({ repos: {}, order: [], activeId: null })
    })
    rerender(hostElement(false, onOpenChange, REPO_ID))

    expect(dialog(container)?.getAttribute('data-open')).toBe('false')
    expect(dialog(container)?.getAttribute('data-repo-id')).toBe(REPO_ID)
  })
})

function hostElement(open: boolean, onOpenChange: (open: boolean) => void, repoId: string) {
  return (
    <QueryClientProvider client={primaryWindowQueryClient}>
      <CreateWorktreeDialogHost open={open} onOpenChange={onOpenChange} repoId={repoId} />
    </QueryClientProvider>
  )
}

function dialog(container: HTMLElement): Element | null {
  return container.querySelector('[data-testid="create-worktree-dialog"]')
}
