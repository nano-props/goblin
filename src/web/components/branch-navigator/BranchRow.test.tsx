// @vitest-environment jsdom

import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchRow } from '#/web/components/branch-navigator/BranchRow.tsx'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { createRepoBranch } from '#/web/test-utils/bridge.ts'

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
  vi.useRealTimers()
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
        />
      </ul>,
    )

    expect(document.querySelector('[data-testid="branch-summary-icon"][aria-label="有改动"]')).not.toBeNull()
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
        />
      </ul>,
    )

    expect(document.querySelector('[data-testid="branch-summary-icon"][aria-label="有改动"]')).not.toBeNull()
  })

  test('shows terminal bell count badges in the action slot in non-compact mode', () => {
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
          terminalBellCount={3}
        />
      </ul>,
    )

    const badge = document.querySelector('[aria-label="3 个未读终端提醒"]')
    const branchIcon = document.querySelector('[data-testid="branch-summary-icon"]')
    const actionArea = document.querySelector('li')?.children[1]
    expect(badge?.textContent).toBe('3')
    expect(badge?.className).toContain('bg-notification')
    expect(branchIcon).not.toBeNull()
    expect(actionArea?.contains(badge ?? null)).toBe(true)
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
        />
      </ul>,
    )

    expect(document.querySelector('[data-testid="branch-summary-icon"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="0 个未读终端提醒"]')).toBeNull()
  })

  test('does not increase branch name font weight when the row is selected', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    const branch = createRepoBranch('feature/a')

    render(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected="feature/a"
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={createRef<HTMLLIElement>()}
        />
      </ul>,
    )

    const branchLabel = Array.from(document.querySelectorAll('span')).find(
      (node) => node.textContent === 'feature/a' && node.className.includes('text-[13px]'),
    )
    expect(branchLabel?.className).toContain('font-normal')
    expect(branchLabel?.className).not.toContain('font-medium')
  })

  test('keeps the leading terminal bell badge behavior in compact mode', () => {
    responsiveMocks.compact = true
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
          terminalBellCount={3}
        />
      </ul>,
    )

    const badge = document.querySelector('[aria-label="3 个未读终端提醒"]')
    const branchIcon = document.querySelector('[data-testid="branch-summary-icon"]')
    const branchLabel = Array.from(document.querySelectorAll('span')).find((node) => node.textContent === 'feature/a')
    const actionArea = document.querySelector('li')?.children[1]

    expect(badge).not.toBeNull()
    expect(badge?.className).toContain('bg-notification')
    expect(branchIcon).toBeNull()
    expect(branchLabel).not.toBeUndefined()
    expect(actionArea?.contains(badge ?? null)).toBe(false)
    expect(badge!.compareDocumentPosition(branchLabel!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('shows the relative commit time without the last commit author', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-05T12:00:00.000Z'))
    const repo = emptyRepo('/tmp/repo', 'repo')
    const branch = createRepoBranch('feature/a', {
      lastCommitAuthor: 'Example Author',
      lastCommitDate: '2026-06-05T10:00:00.000Z',
    })

    render(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={createRef<HTMLLIElement>()}
        />
      </ul>,
    )

    const rowText = document.body.textContent ?? ''
    const summaryTitle = document.querySelector('[title*="feature/a"]')?.getAttribute('title') ?? ''
    expect(rowText).toContain('2 小时前')
    expect(rowText).not.toContain('Example Author')
    expect(summaryTitle).toContain('2 小时前')
    expect(summaryTitle).not.toContain('Example Author')
  })

  test('hides the actions wrapper by default and reveals it on row hover in non-compact mode', () => {
    const className = renderRow(false)?.className ?? ''
    expect(document.querySelector('li')?.className).toContain('group')
    expect(className).toContain('opacity-0')
    expect(className).toContain('pointer-events-none')
    expect(className).toContain('group-hover:pointer-events-auto')
    expect(className).toContain('group-hover:opacity-100')
    expect(className).toContain('group-focus-within:opacity-100')
    expect(className).toContain('transition-opacity')
  })

  test('keeps the actions wrapper visible while the action popover is open in non-compact mode', () => {
    const className = renderRow(false, { actionMenuOpen: true })?.className ?? ''
    expect(className).not.toContain('opacity-0')
    expect(className).not.toContain('group-hover:opacity-100')
    expect(className).not.toContain('group-focus-within:opacity-100')
  })

  test('keeps the actions wrapper fully visible in compact mode', () => {
    const className = renderRow(true)?.className ?? ''
    expect(className).not.toContain('opacity-0')
    expect(className).not.toContain('group-hover:opacity-100')
    expect(className).not.toContain('group-focus-within:opacity-100')
  })

  test('keeps the actions wrapper visible while the row reports a busy branch action', () => {
    const className = renderRow(false, { branchActionBusy: true })?.className ?? ''
    expect(className).not.toContain('opacity-0')
    expect(className).not.toContain('group-hover:opacity-100')
    expect(className).not.toContain('group-focus-within:opacity-100')
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
        actionMenuOpen={options.actionMenuOpen}
        onActionMenuOpenChange={vi.fn()}
        branchActionBusy={options.branchActionBusy}
      />
    </ul>,
  )
  return branchActionMenuShell()
}

function branchActionMenuShell(): HTMLDivElement | undefined {
  const actionArea = document.querySelector('li')?.children[1]
  return actionArea?.firstElementChild?.lastElementChild as HTMLDivElement | undefined
}
