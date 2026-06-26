// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useRepoToasts } from '#/web/hooks/useRepoToasts.tsx'
import { resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))
const i18nMocks = vi.hoisted(() => ({
  dict: {
    'action.create-worktree-created-title': 'Created worktree',
    'worktree-bootstrap.summary.copy-one': 'Copied {count} path: {paths}{moreSuffix}',
    'worktree-bootstrap.summary.copy-other': 'Copied {count} paths: {paths}{moreSuffix}',
    'worktree-bootstrap.summary.skipped-missing-one': 'Skipped missing {count} path: {paths}{moreSuffix}',
    'worktree-bootstrap.summary.skipped-missing-other': 'Skipped missing {count} paths: {paths}{moreSuffix}',
    'worktree-bootstrap.summary.setup': 'Ran setup: {command}',
  } as Record<string, string>,
  interpolate(template: string, params?: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => String(params?.[key] ?? match))
  },
}))

vi.mock('sonner', () => ({
  toast: toastMocks,
}))

vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    i18nMocks.interpolate(i18nMocks.dict[key] ?? key, params),
}))

const REPO_ID = '/tmp/repo-toasts-test'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  resetReposStore()
  toastMocks.success.mockClear()
  toastMocks.error.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  if (root) {
    act(() => {
      root.unmount()
    })
  }
  host?.remove()
})

describe('useRepoToasts', () => {
  test('shows worktree bootstrap details on create-worktree success toasts', async () => {
    const token = seedRepoState({ id: REPO_ID }).instanceToken
    useReposStore.getState().setLastResult(
      REPO_ID,
      {
        ok: true,
        message: 'Copied 1 path: .env.local',
        worktreeBootstrap: {
          copy: { count: 1, paths: ['.env.local'] },
          symlink: { count: 0, paths: [] },
          hardlink: { count: 0, paths: [] },
          skippedMissing: { count: 1, paths: ['missing.env'] },
          setup: { command: 'bun install' },
        },
      },
      token,
      { action: { kind: 'createWorktree', branch: 'feature/a', worktreePath: '/tmp/worktrees/feature-a' } },
    )

    await act(async () => {
      root.render(<Harness repoId={REPO_ID} />)
    })

    expect(toastMocks.success).toHaveBeenCalledTimes(1)
    const [, options] = toastMocks.success.mock.calls[0]!
    expect(String(options.description.props.children)).toContain('Copied 1 path: .env.local')
    expect(String(options.description.props.children)).toContain('Skipped missing 1 path: missing.env')
    expect(String(options.description.props.children)).toContain('Ran setup: bun install')
  })
})

function Harness({ repoId }: { repoId: string }) {
  useRepoToasts(repoId)
  return null
}
