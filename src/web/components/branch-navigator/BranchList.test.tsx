// @vitest-environment jsdom

// Unit tests for the presentational BranchList. Its contract is
// "given branches + a highlighted name + callbacks, paint rows and
// bubble events up". We stub BranchActionsMenu and the terminal bell/output
// hook so the suite stays focused on the list.

import { afterEach, describe, expect, test, vi } from 'vitest'
import { BranchList } from '#/web/components/branch-navigator/BranchList.tsx'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { createGitRepoPresentationForTest, createRepoBranch } from '#/web/test-utils/bridge.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

// Side-effect import: registers a partial mock of `#/web/stores/i18n.ts`
// that delegates to the real module so `i18next.use(initReactI18next).
// init({…})` still runs (which is what wires the i18next singleton into
// `react-i18next`'s module-scoped closure, the one `<Trans>` reads
// from), and only overrides `useT` to return raw keys. See
// `src/test-utils/i18n-mock.ts` for the rationale and the importOriginal
// pattern that backs this side effect.
import { stubI18n } from '#/test-utils/i18n-mock.ts'
stubI18n()

vi.mock('#/web/components/BranchActionsMenu.tsx', () => ({
  BranchActionsMenu: () => null,
}))

vi.mock('#/web/components/terminal/terminal-session-store.ts', () => ({
  useTerminalWorktreeOutputActive: () => false,
  useTerminalWorktreeBellCount: () => 0,
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('BranchList', () => {
  test('renders one row per branch and forwards click/double-click', () => {
    const branches = [createRepoBranch('main'), createRepoBranch('feature/a'), createRepoBranch('fix/b')]
    const repo = branchListRepo(branches, 'main')
    const onSelect = vi.fn()
    const onOpenStatus = vi.fn()

    const { container } = renderInJsdom(
      <BranchList
        repo={repo}
        branches={branches}
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
    const repo = branchListRepo([], '')
    const onSelect = vi.fn()

    const { container } = renderInJsdom(
      <BranchList
        repo={repo}
        branches={[]}
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
      <BranchList
        repo={null}
        branches={[createRepoBranch('main')]}
        highlightedBranch={null}
        onSelectBranch={() => {}}
        onOpenBranchStatus={() => {}}
        emptyState={<div data-testid="empty">repo not loaded</div>}
      />,
    )

    expect(container.querySelector('ul')).toBeNull()
    expect(container.querySelector('[data-testid="empty"]')?.textContent).toBe('repo not loaded')
  })

  test('highlights the row whose name matches highlightedBranch', () => {
    const branches = [createRepoBranch('main'), createRepoBranch('feature/a'), createRepoBranch('fix/b')]
    const repo = branchListRepo(branches, 'main')

    const { container } = renderInJsdom(
      <BranchList
        repo={repo}
        branches={branches}
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
})

function branchListRepo(branches: ReturnType<typeof createRepoBranch>[], currentBranch: string) {
  return createGitRepoPresentationForTest(
    emptyWorkspace(workspaceIdForTest('goblin+file:///tmp/repo'), 'repo', 'repo-runtime-test'),
    {
      branches,
      currentBranch,
      status: [],
      worktreesByPath: {},
    },
  )
}
