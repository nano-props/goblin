// @vitest-environment jsdom
import {
  resetWorkspacesStore,
  seedRepoShellForTest,
  createGitWorkspaceProbeForTest,
} from '#/web/test-utils/repo-store.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useRepoToasts } from '#/web/hooks/useRepoToasts.tsx'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { appI18n } from '#/web/stores/i18n-vue.ts'
import { defineComponent, isVNode } from 'vue'

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))
const i18nMocks = vi.hoisted(() => ({
  dict: {
    'action.create-worktree-created-title': 'Created worktree',
    'error.worktree-created-followup-failed': 'The worktree was created, but saving trust failed.',
    'worktree-bootstrap.summary.copy-one': 'Copied {count} path: {paths}{moreSuffix}',
    'worktree-bootstrap.summary.copy-other': 'Copied {count} paths: {paths}{moreSuffix}',
    'worktree-bootstrap.summary.skipped-missing-one': 'Skipped missing {count} path: {paths}{moreSuffix}',
    'worktree-bootstrap.summary.skipped-missing-other': 'Skipped missing {count} paths: {paths}{moreSuffix}',
    'worktree-bootstrap.summary.setup': 'Ran setup: {command}',
  } as Record<string, string>,
}))

vi.mock('vue-sonner', () => ({
  toast: toastMocks,
}))

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/repo-toasts-test')

beforeEach(() => {
  appI18n.global.setLocaleMessage('en', i18nMocks.dict)
  appI18n.global.locale.value = 'en'
  resetWorkspacesStore()
  toastMocks.success.mockClear()
  toastMocks.error.mockClear()
})

describe('useRepoToasts', () => {
  test('shows worktree bootstrap details on create-worktree success toasts', async () => {
    const workspaceRuntimeId = seedRepoShellForTest({
      id: REPO_ID,
      workspaceProbe: createGitWorkspaceProbeForTest(),
    }).workspaceRuntimeId
    workspacesStore.getState().setLastResult(
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
      workspaceRuntimeId,
      { action: { kind: 'createWorktree', branch: 'feature/a', worktreePath: '/tmp/worktrees/feature-a' } },
    )

    renderInJsdom(<Harness repoId={REPO_ID} />)

    expect(toastMocks.success).toHaveBeenCalledTimes(1)
    const [, options] = toastMocks.success.mock.calls[0]!
    const description = toastDescriptionText(options.description)
    expect(description).toContain('Copied 1 path: .env.local')
    expect(description).toContain('Skipped missing 1 path: missing.env')
    expect(description).toContain('Ran setup: bun install')
  })

  test('shows the recovery message before bootstrap details on create-worktree failure', async () => {
    const workspaceRuntimeId = seedRepoShellForTest({
      id: REPO_ID,
      workspaceProbe: createGitWorkspaceProbeForTest(),
    }).workspaceRuntimeId
    workspacesStore.getState().setLastResult(
      REPO_ID,
      {
        ok: false,
        message: 'setup exited with status 1',
        recoveryMessageKeys: ['error.worktree-created-followup-failed'],
        worktreeBootstrap: {
          copy: { count: 1, paths: ['.env.local'] },
          symlink: { count: 0, paths: [] },
          hardlink: { count: 0, paths: [] },
          skippedMissing: { count: 0, paths: [] },
        },
      },
      workspaceRuntimeId,
      { action: { kind: 'createWorktree', branch: 'feature/a', worktreePath: '/tmp/worktrees/feature-a' } },
    )

    renderInJsdom(<Harness repoId={REPO_ID} />)

    expect(toastMocks.error).toHaveBeenCalledTimes(1)
    const [, options] = toastMocks.error.mock.calls[0]!
    expect(toastDescriptionText(options.description)).toBe(
      'setup exited with status 1\nThe worktree was created, but saving trust failed.\nCopied 1 path: .env.local',
    )
  })
})

const Harness = defineComponent<{ repoId: WorkspaceId }>({
  name: 'RepoToastsHarness',
  props: ['repoId'],
  setup(props) {
    useRepoToasts(() => props.repoId)
    return () => null
  },
})

function toastDescriptionText(description: unknown): string {
  if (!isVNode(description)) throw new Error('expected a Vue toast description')
  const { container } = renderInJsdom(description)
  return container.querySelector('pre')?.textContent ?? ''
}
