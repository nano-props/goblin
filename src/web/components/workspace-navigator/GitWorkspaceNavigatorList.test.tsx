// @vitest-environment jsdom

// Unit tests for the presentational GitWorkspaceNavigatorList. Its contract is
// "given branches + a highlighted name + callbacks, paint rows and
// bubble events up". We stub BranchActionsMenu and the terminal bell/output
// hook so the suite stays focused on the list.

import {
  createRepoBranch,
  createGitRepoPresentationForTest,
  createRepoWorktreeSnapshotForTest,
} from '#/web/test-utils/repo-store.ts'
import type { RepoWorktreeSnapshot } from '#/shared/git-types.ts'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { GitWorkspaceNavigatorList } from '#/web/components/workspace-navigator/GitWorkspaceNavigatorList.tsx'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { nextTick } from 'vue'

vi.mock('#/web/components/BranchActionsMenu.tsx', () => ({
  BranchActionsMenu: (props: { open?: boolean; onOpenChange?: (open: boolean) => void }) => (
    <button
      type="button"
      data-testid="branch-actions-menu"
      data-open={props.open ? 'true' : 'false'}
      onClick={() => props.onOpenChange?.(true)}
    />
  ),
}))

vi.mock('#/web/components/terminal/terminal-session-store.ts', () => ({
  useTerminalFilesystemTargetOutputActive: () => false,
  useTerminalFilesystemTargetBellCount: () => 0,
}))

afterEach(() => {
  vi.clearAllMocks()
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

describe('GitWorkspaceNavigatorList', () => {
  test('renders one row per branch and forwards click/double-click', () => {
    const branches = [createRepoBranch('main'), createRepoBranch('feature/a'), createRepoBranch('fix/b')]
    const repo = gitWorkspaceNavigatorRepo(branches, 'main')
    const onSelect = vi.fn()
    const onOpenStatus = vi.fn()

    const { container } = renderInJsdom(
      <GitWorkspaceNavigatorList
        repo={repo}
        rows={branches.map((branch) => ({ kind: 'branch' as const, branch }))}
        highlightedBranch="main"
        onSelectBranch={onSelect}
        onOpenBranchStatus={onOpenStatus}
        emptyState={null}
      />,
    )

    const items = Array.from(container.querySelectorAll('li'))
    expect(items).toHaveLength(3)

    items[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onSelect).toHaveBeenCalledWith('feature/a')

    items[2]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(onOpenStatus).toHaveBeenCalledWith('fix/b')
  })

  test('renders the emptyState slot when branches is empty', () => {
    const repo = gitWorkspaceNavigatorRepo([], '')
    const onSelect = vi.fn()

    const { container } = renderInJsdom(
      <GitWorkspaceNavigatorList
        repo={repo}
        rows={[]}
        highlightedBranch={null}
        onSelectBranch={onSelect}
        onOpenBranchStatus={() => {}}
        emptyState={<div data-testid="empty">nothing here</div>}
      />,
    )

    expect(container.querySelector('ul')).toBeNull()
    expect(container.querySelector('[data-testid="empty"]')?.textContent).toBe('nothing here')
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('renders the emptyState slot when repo is null', () => {
    // `branches` is non-empty so the `!repo` branch is the one that
    // short-circuits — passing `branches={[]}` would exercise the
    // empty-list early-return instead.
    const { container } = renderInJsdom(
      <GitWorkspaceNavigatorList
        repo={null}
        rows={[{ kind: 'branch', branch: createRepoBranch('main') }]}
        highlightedBranch={null}
        onSelectBranch={() => {}}
        onOpenBranchStatus={() => {}}
        emptyState={<div data-testid="empty">repo not loaded</div>}
      />,
    )

    expect(container.querySelector('ul')).toBeNull()
    expect(container.querySelector('[data-testid="empty"]')?.textContent).toBe('repo not loaded')
  })

  test('renders an unborn attached worktree without a branch row', () => {
    const worktree: RepoWorktreeSnapshot = {
      ...createRepoWorktreeSnapshotForTest('main', '/tmp/repo'),
      headOid: null,
    }
    const repo = gitWorkspaceNavigatorRepo([], 'main', [worktree])
    const onSelectWorktree = vi.fn()

    const { container } = renderInJsdom(
      <GitWorkspaceNavigatorList
        repo={repo}
        rows={[{ kind: 'worktree', branch: null, worktree }]}
        highlightedBranch={null}
        highlightedWorktreePath={worktree.path}
        onSelectBranch={() => {}}
        onOpenBranchStatus={() => {}}
        onSelectWorktree={onSelectWorktree}
        emptyState={null}
      />,
    )

    const row = container.querySelector('li')
    expect(row).not.toBeNull()
    expect(row?.textContent).toContain('main')
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onSelectWorktree).toHaveBeenCalledWith(worktree.path)
  })

  test('highlights the row whose name matches highlightedBranch', () => {
    const branches = [createRepoBranch('main'), createRepoBranch('feature/a'), createRepoBranch('fix/b')]
    const repo = gitWorkspaceNavigatorRepo(branches, 'main')

    const { container } = renderInJsdom(
      <GitWorkspaceNavigatorList
        repo={repo}
        rows={branches.map((branch) => ({ kind: 'branch' as const, branch }))}
        highlightedBranch="fix/b"
        onSelectBranch={() => {}}
        onOpenBranchStatus={() => {}}
        emptyState={null}
      />,
    )

    const items = Array.from(container.querySelectorAll('li'))
    expect(items[2]?.className).toContain('bg-selected')
    expect(items[0]?.className).not.toContain('bg-selected')
    expect(items[1]?.className).not.toContain('bg-selected')
  })

  test('closes a branch action menu when the row changes to operation presentation', async () => {
    const branch = createRepoBranch('feature/a')
    const attached = createRepoWorktreeSnapshotForTest(branch.name, '/tmp/feature-a')
    const repo = gitWorkspaceNavigatorRepo([branch], branch.name, [attached])
    const props = {
      repo,
      highlightedBranch: null,
      highlightedWorktreePath: attached.path,
      onSelectBranch: () => {},
      onOpenBranchStatus: () => {},
      emptyState: null,
    }
    const { container, rerender } = renderInJsdom(
      <GitWorkspaceNavigatorList {...props} rows={[{ kind: 'worktree', branch, worktree: attached }]} />,
    )

    const menu = container.querySelector('[data-testid="branch-actions-menu"]')
    if (!(menu instanceof HTMLButtonElement)) throw new Error('missing branch actions menu')
    menu.click()
    await nextTick()
    expect(menu.dataset.open).toBe('true')

    const rebasing: RepoWorktreeSnapshot = {
      ...attached,
      head: { kind: 'detached' },
      operation: { kind: 'rebase' },
    }
    await rerender(<GitWorkspaceNavigatorList {...props} rows={[{ kind: 'worktree', branch, worktree: rebasing }]} />)
    expect(container.querySelector('[data-testid="branch-actions-menu"]')).toBeNull()

    await rerender(<GitWorkspaceNavigatorList {...props} rows={[{ kind: 'worktree', branch, worktree: attached }]} />)
    expect(container.querySelector('[data-testid="branch-actions-menu"]')?.getAttribute('data-open')).toBe('false')
  })

  test('scrolls the initially highlighted row into view after its ref mounts', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    const branches = [createRepoBranch('main'), createRepoBranch('feature/a'), createRepoBranch('fix/b')]
    const repo = gitWorkspaceNavigatorRepo(branches, 'main')
    const { container } = renderInJsdom(
      <GitWorkspaceNavigatorList
        repo={repo}
        rows={branches.map((branch) => ({ kind: 'branch' as const, branch }))}
        highlightedBranch="fix/b"
        onSelectBranch={() => {}}
        onOpenBranchStatus={() => {}}
        emptyState={null}
      />,
    )
    await nextTick()

    const highlightedRow = container.querySelectorAll('li')[2]
    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(scrollIntoView.mock.contexts[0]).toBe(highlightedRow)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })
})

function gitWorkspaceNavigatorRepo(
  branches: ReturnType<typeof createRepoBranch>[],
  currentBranch: string,
  worktrees?: RepoWorktreeSnapshot[],
) {
  return createGitRepoPresentationForTest(
    emptyWorkspace(workspaceIdForTest('goblin+file:///tmp/repo'), 'repo-runtime-test'),
    {
      branches,
      currentBranch,
      status: [],
      worktrees,
    },
  )
}
