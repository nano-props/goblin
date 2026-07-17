// @vitest-environment jsdom
// Partial mock of `#/web/stores/i18n.ts`: delegates to the real
// module so `i18next.use(initReactI18next).init({…})` still runs,
// then overrides `useT` with a dictionary-based interpolator
// (`i18nMocks.dict` + `i18nMocks.interpolate`) that the assertions
// on toast summaries can match against. The simple `stubI18n`
// helper only covers the `useT → raw key` case; richer overrides
// write their own `vi.mock(import(...), importOriginal)` and
// spread `actual` to keep the i18next init side effect live.
vi.mock(import('#/web/stores/i18n.ts'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useT: (() => (key: string, params?: Record<string, string | number>) =>
      i18nMocks.interpolate(i18nMocks.dict[key] ?? key, params)) as typeof actual.useT,
  }
})

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRepoToasts } from '#/web/hooks/useRepoToasts.tsx'
import { resetReposStore, seedRepoShellForTest } from '#/web/test-utils/bridge.ts'
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

const REPO_ID = 'goblin+file:///tmp/repo-toasts-test'

beforeEach(() => {
  resetReposStore()
  toastMocks.success.mockClear()
  toastMocks.error.mockClear()
})

describe('useRepoToasts', () => {
  test('shows worktree bootstrap details on create-worktree success toasts', async () => {
    const repoRuntimeId = seedRepoShellForTest({ id: REPO_ID }).repoRuntimeId
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
      repoRuntimeId,
      { action: { kind: 'createWorktree', branch: 'feature/a', worktreePath: '/tmp/worktrees/feature-a' } },
    )

    renderInJsdom(<Harness repoId={REPO_ID} />)

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
