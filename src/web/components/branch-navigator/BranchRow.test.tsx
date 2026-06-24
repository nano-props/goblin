// @vitest-environment jsdom

import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchRow } from '#/web/components/branch-navigator/BranchRow.tsx'
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
      case 'branches.default':
        return '默认'
      case 'branches.gone':
        return '已失联'
      case 'terminal.bell-unread-count':
        return `${params?.count ?? 0} 个未读终端提醒`
      case 'branch-status.changes-count':
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

const responsiveMocks = vi.hoisted(() => ({
  compact: false,
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => responsiveMocks.compact,
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
  responsiveMocks.compact = false
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

  test('shows a terminal bell count badge for branches with unread terminal bells', () => {
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
          terminalBellCount={3}
        />
      </ul>,
    )

    const badge = document.querySelector('[aria-label="3 个未读终端提醒"]')
    expect(badge?.textContent).toBe('3')
  })

  test('keeps the branch icon when there are no unread terminal bells', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    const branch = createRepoBranch('feature/a')

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

    expect(document.querySelector('[data-testid="branch-summary-icon"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="0 个未读终端提醒"]')).toBeNull()
  })

  test('replaces the branch icon with the terminal bell badge', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    const branch = createRepoBranch('feature/a')

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
          terminalBellCount={3}
        />
      </ul>,
    )

    const badge = document.querySelector('[aria-label="3 个未读终端提醒"]')
    const branchIcon = document.querySelector('[data-testid="branch-summary-icon"]')
    const branchLabel = Array.from(document.querySelectorAll('span')).find((node) => node.textContent === 'feature/a')

    expect(badge).not.toBeNull()
    expect(badge?.className).toContain('bg-notification')
    expect(branchIcon).toBeNull()
    expect(branchLabel).not.toBeUndefined()
    expect(badge!.compareDocumentPosition(branchLabel!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('hides the actions wrapper by default and reveals it on row hover in non-compact mode', () => {
    const className = renderRow(false)?.className ?? ''
    expect(document.querySelector('li')?.className).toContain('group')
    expect(className).toContain('opacity-0')
    expect(className).toContain('group-hover:opacity-100')
    expect(className).toContain('focus-visible:opacity-100')
    expect(className).toContain('transition-opacity')
  })

  test('keeps the actions wrapper visible while the action popover is open in non-compact mode', () => {
    const className = renderRow(false, { actionMenuOpen: true })?.className ?? ''
    expect(className).not.toContain('opacity-0')
    expect(className).not.toContain('group-hover:opacity-100')
    expect(className).not.toContain('focus-visible:opacity-100')
  })

  test('keeps the actions wrapper fully visible in compact mode', () => {
    const className = renderRow(true)?.className ?? ''
    expect(className).not.toContain('opacity-0')
    expect(className).not.toContain('group-hover:opacity-100')
    expect(className).not.toContain('focus-visible:opacity-100')
  })

  test('keeps the actions wrapper visible while the row reports a busy branch action', () => {
    const className = renderRow(false, { branchActionBusy: true })?.className ?? ''
    expect(className).not.toContain('opacity-0')
    expect(className).not.toContain('group-hover:opacity-100')
    expect(className).not.toContain('focus-visible:opacity-100')
  })
})

function render(element: React.ReactNode) {
  act(() => {
    root!.render(element)
  })
}

function renderRow(
  compact: boolean,
  options: { actionMenuOpen?: boolean; branchActionBusy?: boolean } = {},
): HTMLDivElement | undefined {
  responsiveMocks.compact = compact
  const repo = emptyRepo('/tmp/repo', 'repo')
  const branch = createRepoBranch('feature/a')
  render(
    <ul>
      <BranchRow
        repo={repo}
        branch={branch}
        selected={null}
        onSelectBranch={vi.fn()}
        onOpenBranchStatus={vi.fn()}
        selectedRef={createRef<HTMLLIElement>()}
        showActions
        actionMenuOpen={options.actionMenuOpen}
        onActionMenuOpenChange={vi.fn()}
        branchActionBusy={options.branchActionBusy}
      />
    </ul>,
  )
  return document.querySelector('li')?.children[1] as HTMLDivElement | undefined
}
