// @vitest-environment jsdom

import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchRow } from '#/web/components/branch-list/BranchRow.tsx'
import { emptyRepo } from '#/web/stores/repos/helpers.ts'
import { createRepoBranch } from '#/web/stores/repos/test-utils.ts'

vi.mock('#/web/stores/i18n.ts', () => ({
  useI18nStore: (selector: (state: { lang: string }) => string) => selector({ lang: 'zh' }),
  useT: () => (key: string, params?: Record<string, string | number>) => {
    switch (key) {
      case 'branches.dirty':
        return '有改动'
      case 'branches.worktree':
        return '工作树'
      case 'branches.reorder-worktree':
        return '重新排序工作树'
      case 'branches.default':
        return '默认'
      case 'branches.gone':
        return '已失联'
      case 'branch-status.current':
        return '当前'
      case 'branch-status.worktree-dirty':
        return `${params?.n ?? 0} 个改动`
      case 'branch-status.sync.ahead':
        return `领先 ${params?.n ?? 0}`
      case 'branch-status.sync.behind':
        return `落后 ${params?.n ?? 0}`
      default:
        return key
    }
  },
}))

vi.mock('#/web/components/BranchActionsMenu.tsx', () => ({
  BranchActionsMenu: () => null,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('BranchRow', () => {
  test('shows the generic dirty label for dirty worktrees', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    repo.data.worktreesByPath['/tmp/worktree-a'] = {
      path: '/tmp/worktree-a',
      branch: 'feature/a',
      isMain: false,
      isDirty: true,
      changeCount: 7,
    }
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    render(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={createRef<HTMLLIElement>()}
          showActions={false}
        />
      </ul>,
    )

    expect(document.body.textContent).toContain('有改动')
  })

  test('keeps the generic dirty label even when exact counts are unavailable', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    repo.data.worktreesByPath['/tmp/worktree-a'] = {
      path: '/tmp/worktree-a',
      branch: 'feature/a',
      isMain: false,
      isDirty: true,
    }
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    render(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={createRef<HTMLLIElement>()}
          showActions={false}
        />
      </ul>,
    )

    expect(document.body.textContent).toContain('有改动')
  })

  test('shows the formatted worktree directory for linked branches', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    render(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={createRef<HTMLLIElement>()}
          showActions={false}
        />
      </ul>,
    )

    expect(document.body.textContent).toContain('/tmp/worktree-a')
  })

  test('shows only the path for remote worktree directories', () => {
    const repo = emptyRepo('ssh-config://prod/srv/repo', 'repo')
    repo.remote.target = {
      id: 'ssh-config://prod/srv/repo',
      alias: 'prod',
      host: '192.0.2.10',
      user: 'tester',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
    }
    const branch = createRepoBranch('feature/a', { worktree: { path: '/srv/repo-feature' } })

    render(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={createRef<HTMLLIElement>()}
          showActions={false}
        />
      </ul>,
    )

    expect(document.body.textContent).toContain('/srv/repo-feature')
    expect(document.body.textContent).not.toContain('tester@192.0.2.10')
  })

  test('does not add a directory line for branches without worktrees', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    const branch = createRepoBranch('feature/plain')

    render(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={createRef<HTMLLIElement>()}
          showActions={false}
        />
      </ul>,
    )

    expect(document.body.textContent).not.toContain('没有工作树')
    expect(document.body.textContent).not.toContain('no worktree')
  })

  test('renders an isolated drag handle when drag props are provided', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    render(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={createRef<HTMLLIElement>()}
          showActions={false}
          dragHandle={{
            label: '重新排序工作树',
            ref: vi.fn(),
            props: {},
          }}
        />
      </ul>,
    )

    const handle = document.querySelector('[aria-label="重新排序工作树"]')
    expect(handle?.getAttribute('aria-label')).toBe('重新排序工作树')
  })
})

function render(element: React.ReactNode) {
  act(() => {
    root!.render(element)
  })
}
