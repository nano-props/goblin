// @vitest-environment jsdom
// Partial mock of `#/web/stores/i18n.ts`: delegates to the real
// module so `i18next.use(initReactI18next).init({…})` still runs,
// then overrides `useI18nStore` and `useT` for the Chinese-locale
// row labels this file's assertions check. The simple
// `stubI18n` helper only covers the `useT → raw key` case; richer
// overrides write their own `vi.mock(import(...), importOriginal)`
// and spread `actual` to keep the i18next init side effect live.
vi.mock(import('#/web/stores/i18n.ts'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useI18nStore: ((selector: (state: { lang: string }) => string) =>
      selector({ lang: 'zh' })) as typeof actual.useI18nStore,
    useT: (() => (key: string, params?: Record<string, string | number>) => {
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
        case 'terminal.output-active':
          return '终端正在输出'
        case 'branch-status.changes-count':
          return `${params?.n ?? 0} 个改动`
        case 'branch-status.sync.ahead':
          return `领先 ${params?.n ?? 0}`
        case 'branch-status.sync.behind':
          return `落后 ${params?.n ?? 0}`
        default:
          return key
      }
    }) as unknown as typeof actual.useT,
  }
})


import { createRef } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { BranchRow } from '#/web/components/branch-navigator/BranchRow.tsx'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { createRepoBranch, repoStateWithBranchReadModelForTest } from '#/web/test-utils/bridge.ts'

vi.mock('#/web/components/BranchActionsMenu.tsx', () => ({
  BranchActionsMenu: () => null,
}))

const responsiveMocks = vi.hoisted(() => ({
  compact: false,
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => responsiveMocks.compact,
}))

afterEach(() => {
  vi.useRealTimers()
  responsiveMocks.compact = false
})

describe('BranchRow', () => {
  test('shows the generic dirty label for dirty worktrees', () => {
    const repo = branchRowRepo()
    repo.data.worktreesByPath['/tmp/worktree-a'] = {
      path: '/tmp/worktree-a',
      branch: 'feature/a',
      isMain: false,
      isDirty: true,
      changeCount: 7,
    }
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    const { container } = renderInJsdom(
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

    expect(container.querySelector('[data-testid="branch-summary-icon"][aria-label="有改动"]')).not.toBeNull()
  })

  test('keeps the generic dirty label even when exact counts are unavailable', () => {
    const repo = branchRowRepo()
    repo.data.worktreesByPath['/tmp/worktree-a'] = {
      path: '/tmp/worktree-a',
      branch: 'feature/a',
      isMain: false,
      isDirty: true,
    }
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    const { container } = renderInJsdom(
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

    expect(container.querySelector('[data-testid="branch-summary-icon"][aria-label="有改动"]')).not.toBeNull()
  })

  test('shows terminal bell count badges in the action slot in non-compact mode', () => {
    const repo = branchRowRepo()
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    const { container } = renderInJsdom(
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

    const badge = container.querySelector('[aria-label="3 个未读终端提醒"]')
    const branchIcon = container.querySelector('[data-testid="branch-summary-icon"]')
    const actionArea = container.querySelector('li')?.children[1]
    expect(badge?.textContent).toBe('3')
    expect(badge?.className).toContain('bg-notification')
    expect(branchIcon).not.toBeNull()
    expect(actionArea?.contains(badge ?? null)).toBe(true)
  })

  test('shows terminal output activity in the action slot in non-compact mode', () => {
    const repo = branchRowRepo()
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    const { container } = renderInJsdom(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={createRef<HTMLLIElement>()}
          terminalOutputActive
        />
      </ul>,
    )

    const indicator = container.querySelector('[data-testid="terminal-output-activity-indicator"]')
    const branchIcon = container.querySelector('[data-testid="branch-summary-icon"]')
    const actionArea = container.querySelector('li')?.children[1]
    expect(indicator).not.toBeNull()
    expect(indicator?.getAttribute('aria-label')).toBe('终端正在输出')
    expect(branchIcon).not.toBeNull()
    expect(actionArea?.contains(indicator ?? null)).toBe(true)
  })

  test('hides terminal output activity when the branch row is selected in non-compact mode', () => {
    const repo = branchRowRepo()
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    const { container } = renderInJsdom(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected="feature/a"
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={createRef<HTMLLIElement>()}
          terminalOutputActive
        />
      </ul>,
    )

    expect(container.querySelector('[data-testid="terminal-output-activity-indicator"]')).toBeNull()
    expect(container.querySelector('[data-testid="branch-summary-icon"]')).not.toBeNull()
  })

  test('gives terminal bell priority over terminal output activity', () => {
    const repo = branchRowRepo()
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    const { container } = renderInJsdom(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={createRef<HTMLLIElement>()}
          terminalBellCount={2}
          terminalOutputActive
        />
      </ul>,
    )

    expect(container.querySelector('[aria-label="2 个未读终端提醒"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="terminal-output-activity-indicator"]')).toBeNull()
  })

  test('keeps the branch icon when there are no unread terminal bells', () => {
    const repo = branchRowRepo()
    const branch = createRepoBranch('feature/a')

    const { container } = renderInJsdom(
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

    expect(container.querySelector('[data-testid="branch-summary-icon"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="0 个未读终端提醒"]')).toBeNull()
  })

  test('does not increase branch name font weight when the row is selected', () => {
    const repo = branchRowRepo()
    const branch = createRepoBranch('feature/a')

    const { container } = renderInJsdom(
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

    const branchLabel = Array.from(container.querySelectorAll('span')).find(
      (node) => node.textContent === 'feature/a' && node.className.includes('text-[13px]'),
    )
    expect(branchLabel?.className).toContain('font-normal')
    expect(branchLabel?.className).not.toContain('font-medium')
  })

  test('keeps the leading terminal bell badge behavior in compact mode', () => {
    responsiveMocks.compact = true
    const repo = branchRowRepo()
    const branch = createRepoBranch('feature/a')

    const { container } = renderInJsdom(
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

    const badge = container.querySelector('[aria-label="3 个未读终端提醒"]')
    const branchIcon = container.querySelector('[data-testid="branch-summary-icon"]')
    const branchLabel = Array.from(container.querySelectorAll('span')).find((node) => node.textContent === 'feature/a')
    const actionArea = container.querySelector('li')?.children[1]

    expect(badge).not.toBeNull()
    expect(badge?.className).toContain('bg-notification')
    expect(branchIcon).toBeNull()
    expect(branchLabel).not.toBeUndefined()
    expect(actionArea?.contains(badge ?? null)).toBe(false)
    expect(badge!.compareDocumentPosition(branchLabel!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('shows terminal output activity on the leading edge in compact mode', () => {
    responsiveMocks.compact = true
    const repo = branchRowRepo()
    const branch = createRepoBranch('feature/a')

    const { container } = renderInJsdom(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={createRef<HTMLLIElement>()}
          terminalOutputActive
        />
      </ul>,
    )

    const indicator = container.querySelector('[data-testid="terminal-output-activity-indicator"]')
    const branchIcon = container.querySelector('[data-testid="branch-summary-icon"]')
    const branchLabel = Array.from(container.querySelectorAll('span')).find((node) => node.textContent === 'feature/a')
    const actionArea = container.querySelector('li')?.children[1]

    expect(indicator).not.toBeNull()
    expect(branchIcon).toBeNull()
    expect(branchLabel).not.toBeUndefined()
    expect(actionArea?.contains(indicator ?? null)).toBe(false)
    expect(indicator!.compareDocumentPosition(branchLabel!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('lets compact terminal output activity take the leading slot over the dirty worktree icon', () => {
    responsiveMocks.compact = true
    const repo = branchRowRepo()
    repo.data.worktreesByPath['/tmp/worktree-a'] = {
      path: '/tmp/worktree-a',
      branch: 'feature/a',
      isMain: false,
      isDirty: true,
      changeCount: 3,
    }
    const branch = createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })

    const { container } = renderInJsdom(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={createRef<HTMLLIElement>()}
          terminalOutputActive
        />
      </ul>,
    )

    const indicator = container.querySelector('[data-testid="terminal-output-activity-indicator"]')
    const branchIcon = container.querySelector('[data-testid="branch-summary-icon"]')
    const summaryTitle = container.querySelector('[title]')?.getAttribute('title')

    expect(indicator).not.toBeNull()
    expect(branchIcon).toBeNull()
    expect(summaryTitle).toContain('有改动')
    expect(summaryTitle).toContain('终端正在输出')
  })

  test('hides terminal output activity when the branch row is selected in compact mode', () => {
    responsiveMocks.compact = true
    const repo = branchRowRepo()
    const branch = createRepoBranch('feature/a')

    const { container } = renderInJsdom(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected="feature/a"
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={createRef<HTMLLIElement>()}
          terminalOutputActive
        />
      </ul>,
    )

    expect(container.querySelector('[data-testid="terminal-output-activity-indicator"]')).toBeNull()
    expect(container.querySelector('[data-testid="branch-summary-icon"]')).not.toBeNull()
  })

  test('shows the relative commit time without the last commit author', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-05T12:00:00.000Z'))
    const repo = branchRowRepo()
    const branch = createRepoBranch('feature/a', {
      lastCommitAuthor: 'Example Author',
      lastCommitDate: '2026-06-05T10:00:00.000Z',
    })

    const { container } = renderInJsdom(
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

    const rowText = container.textContent ?? ''
    const summaryTitle = container.querySelector('[title*="feature/a"]')?.getAttribute('title') ?? ''
    expect(rowText).toContain('2 小时前')
    expect(rowText).not.toContain('Example Author')
    expect(summaryTitle).toContain('2 小时前')
    expect(summaryTitle).not.toContain('Example Author')
  })

  test('hides the actions wrapper by default and reveals it on row hover in non-compact mode', () => {
    const { container, shell } = renderRow(false)
    const className = shell?.className ?? ''
    expect(container.querySelector('li')?.className).toContain('group')
    expect(className).toContain('opacity-0')
    expect(className).toContain('pointer-events-none')
    expect(className).toContain('group-hover:pointer-events-auto')
    expect(className).toContain('group-hover:opacity-100')
    expect(className).toContain('group-focus-within:opacity-100')
    expect(className).toContain('transition-opacity')
  })

  test('keeps the actions wrapper visible while the action popover is open in non-compact mode', () => {
    const { shell } = renderRow(false, { actionMenuOpen: true })
    const className = shell?.className ?? ''
    expect(className).not.toContain('opacity-0')
    expect(className).not.toContain('group-hover:opacity-100')
    expect(className).not.toContain('group-focus-within:opacity-100')
  })

  test('keeps the actions wrapper fully visible in compact mode', () => {
    const { shell } = renderRow(true)
    const className = shell?.className ?? ''
    expect(className).not.toContain('opacity-0')
    expect(className).not.toContain('group-hover:opacity-100')
    expect(className).not.toContain('group-focus-within:opacity-100')
  })

  test('keeps the actions wrapper visible while the row reports a busy branch action', () => {
    const { shell } = renderRow(false, { branchActionBusy: true })
    const className = shell?.className ?? ''
    expect(className).not.toContain('opacity-0')
    expect(className).not.toContain('group-hover:opacity-100')
    expect(className).not.toContain('group-focus-within:opacity-100')
  })
})

function renderRow(
  compact: boolean,
  options: { actionMenuOpen?: boolean; branchActionBusy?: boolean; terminalOutputActive?: boolean } = {},
): { container: HTMLElement; shell: HTMLDivElement | undefined } {
  responsiveMocks.compact = compact
  const repo = branchRowRepo()
  const branch = createRepoBranch('feature/a')
  const { container } = renderInJsdom(
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
        terminalOutputActive={options.terminalOutputActive}
      />
    </ul>,
  )
  return { container, shell: branchActionMenuShell(container) }
}

function branchActionMenuShell(container: HTMLElement): HTMLDivElement | undefined {
  const actionArea = container.querySelector('li')?.children[1]
  return actionArea?.firstElementChild?.lastElementChild as HTMLDivElement | undefined
}

function branchRowRepo() {
  return repoStateWithBranchReadModelForTest(emptyRepo('/tmp/repo', 'repo', 'repo-instance-test'), {
    branches: [],
    currentBranch: '',
    status: [],
    worktreesByPath: {},
  })
}
