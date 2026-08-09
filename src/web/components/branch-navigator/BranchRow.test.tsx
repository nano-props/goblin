// @vitest-environment jsdom
import { createRepoBranch, createGitRepoPresentationForTest } from '#/web/test-utils/repo-store.ts'
import { shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { BranchRow } from '#/web/components/branch-navigator/BranchRow.tsx'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { i18nStore } from '#/web/stores/i18n.ts'
import { appI18n } from '#/web/stores/i18n-vue.ts'

vi.mock('#/web/components/BranchActionsMenu.tsx', () => ({
  BranchActionsMenu: () => null,
}))

const responsiveMocks = vi.hoisted(() => ({
  compact: false,
}))
const BRANCH_ROW_MESSAGES: Record<string, string> = {
  'branches.dirty': '有改动',
  'branches.worktree': '工作树',
  'branches.default': '默认',
  'branches.gone': '已失联',
  'terminal.bell-unread-count': '{count} 个未读终端提醒',
  'terminal.output-active': '终端正在输出',
  'branch-status.changes-count': '{n} 个改动',
  'branch-status.sync.ahead': '领先 {n}',
  'branch-status.sync.behind': '落后 {n}',
}

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => ({
    get value() {
      return responsiveMocks.compact
    },
  }),
}))

beforeEach(() => {
  i18nStore.setState({ lang: 'zh', dict: BRANCH_ROW_MESSAGES })
  appI18n.global.setLocaleMessage('zh', BRANCH_ROW_MESSAGES)
  appI18n.global.locale.value = 'zh'
})

afterEach(() => {
  responsiveMocks.compact = false
  i18nStore.setState({ lang: 'en', dict: {} })
  appI18n.global.locale.value = 'en'
})

describe('BranchRow', () => {
  test('shows the generic dirty label for dirty worktrees', async () => {
    const repo = branchRowRepo()
    markDirty(repo, 7)
    const branch = createRepoBranch('feature/a', {
      worktree: { path: '/tmp/worktree-a', isPrimary: false, isLocked: false },
    })

    const { container } = renderInJsdom(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={shallowRef<HTMLLIElement | null>(null)}
        />
      </ul>,
    )

    const icon = container.querySelector('[data-testid="branch-summary-icon"][aria-label="有改动"]')
    expect(icon).not.toBeNull()
    expect(icon?.querySelector('svg')?.className.baseVal).toContain('text-attention')
  })

  test('keeps status-derived dirty presentation unknown when status is unavailable', async () => {
    const repo = branchRowRepo()
    repo.status = undefined
    const branch = createRepoBranch('feature/a', {
      worktree: { path: '/tmp/worktree-a', isPrimary: false, isLocked: false },
    })

    const { container } = renderInJsdom(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={shallowRef<HTMLLIElement | null>(null)}
        />
      </ul>,
    )

    expect(container.querySelector('[data-testid="branch-summary-icon"][aria-label="工作树"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="branch-summary-icon"][aria-label="有改动"]')).toBeNull()
  })

  test.each(['branch:createWorktree', 'branch:removeWorktree'] as const)(
    'shows the worktree icon as clean while %s targets the row',
    (reason) => {
      const repo = branchRowRepo()
      markDirty(repo, 7)
      repo.branchAction = {
        operationId: 1,
        phase: 'running',
        reason,
        target: 'feature/a',
      }
      const branch = createRepoBranch('feature/a', {
        worktree: { path: '/tmp/worktree-a', isPrimary: false, isLocked: false },
      })

      const { container } = renderInJsdom(
        <ul>
          <BranchRow
            repo={repo}
            branch={branch}
            selected={null}
            onSelectBranch={vi.fn()}
            onOpenBranchStatus={vi.fn()}
            selectedRef={shallowRef<HTMLLIElement | null>(null)}
          />
        </ul>,
      )

      const icon = container.querySelector('[data-testid="branch-summary-icon"][aria-label="工作树"]')
      expect(icon).not.toBeNull()
      expect(icon?.querySelector('svg')?.className.baseVal).toContain('text-brand-text')
      expect(icon?.querySelector('svg')?.className.baseVal).not.toContain('text-attention')
      expect(container.querySelector('[data-testid="branch-summary-icon"][aria-label="有改动"]')).toBeNull()
    },
  )

  test('keeps the dirty worktree icon when a worktree operation targets another row', async () => {
    const repo = branchRowRepo()
    markDirty(repo, 7)
    repo.branchAction = {
      operationId: 1,
      phase: 'running',
      reason: 'branch:createWorktree',
      target: 'feature/b',
    }
    const branch = createRepoBranch('feature/a', {
      worktree: { path: '/tmp/worktree-a', isPrimary: false, isLocked: false },
    })

    const { container } = renderInJsdom(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={shallowRef<HTMLLIElement | null>(null)}
        />
      </ul>,
    )

    expect(container.querySelector('[data-testid="branch-summary-icon"][aria-label="有改动"]')).not.toBeNull()
  })

  test('shows terminal bell count badges in the action slot in non-compact mode', async () => {
    const repo = branchRowRepo()
    const branch = createRepoBranch('feature/a', {
      worktree: { path: '/tmp/worktree-a', isPrimary: false, isLocked: false },
    })

    const { container } = renderInJsdom(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={shallowRef<HTMLLIElement | null>(null)}
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

  test('shows terminal output activity in the action slot in non-compact mode', async () => {
    const repo = branchRowRepo()
    const branch = createRepoBranch('feature/a', {
      worktree: { path: '/tmp/worktree-a', isPrimary: false, isLocked: false },
    })

    const { container } = renderInJsdom(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={shallowRef<HTMLLIElement | null>(null)}
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

  test('hides terminal output activity when the branch row is selected in non-compact mode', async () => {
    const repo = branchRowRepo()
    const branch = createRepoBranch('feature/a', {
      worktree: { path: '/tmp/worktree-a', isPrimary: false, isLocked: false },
    })

    const { container } = renderInJsdom(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected="feature/a"
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={shallowRef<HTMLLIElement | null>(null)}
          terminalOutputActive
        />
      </ul>,
    )

    expect(container.querySelector('[data-testid="terminal-output-activity-indicator"]')).toBeNull()
    expect(container.querySelector('[data-testid="branch-summary-icon"]')).not.toBeNull()
  })

  test('gives terminal bell priority over terminal output activity', async () => {
    const repo = branchRowRepo()
    const branch = createRepoBranch('feature/a', {
      worktree: { path: '/tmp/worktree-a', isPrimary: false, isLocked: false },
    })

    const { container } = renderInJsdom(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={shallowRef<HTMLLIElement | null>(null)}
          terminalBellCount={2}
          terminalOutputActive
        />
      </ul>,
    )

    expect(container.querySelector('[aria-label="2 个未读终端提醒"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="terminal-output-activity-indicator"]')).toBeNull()
  })

  test('keeps the branch icon when there are no unread terminal bells', async () => {
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
          selectedRef={shallowRef<HTMLLIElement | null>(null)}
        />
      </ul>,
    )

    expect(container.querySelector('[data-testid="branch-summary-icon"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="0 个未读终端提醒"]')).toBeNull()
  })

  test('does not increase branch name font weight when the row is selected', async () => {
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
          selectedRef={shallowRef<HTMLLIElement | null>(null)}
        />
      </ul>,
    )

    const branchLabel = Array.from(container.querySelectorAll('span')).find(
      (node) => node.textContent === 'feature/a' && node.className.includes('text-[13px]'),
    )
    expect(branchLabel?.className).toContain('font-normal')
    expect(branchLabel?.className).not.toContain('font-medium')
  })

  test('keeps the leading terminal bell badge behavior in compact mode', async () => {
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
          selectedRef={shallowRef<HTMLLIElement | null>(null)}
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

  test('shows terminal output activity on the leading edge in compact mode', async () => {
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
          selectedRef={shallowRef<HTMLLIElement | null>(null)}
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

  test('lets compact terminal output activity take the leading slot over the dirty worktree icon', async () => {
    responsiveMocks.compact = true
    const repo = branchRowRepo()
    markDirty(repo, 3)
    const branch = createRepoBranch('feature/a', {
      worktree: { path: '/tmp/worktree-a', isPrimary: false, isLocked: false },
    })

    const { container } = renderInJsdom(
      <ul>
        <BranchRow
          repo={repo}
          branch={branch}
          selected={null}
          onSelectBranch={vi.fn()}
          onOpenBranchStatus={vi.fn()}
          selectedRef={shallowRef<HTMLLIElement | null>(null)}
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

  test('hides terminal output activity when the branch row is selected in compact mode', async () => {
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
          selectedRef={shallowRef<HTMLLIElement | null>(null)}
          terminalOutputActive
        />
      </ul>,
    )

    expect(container.querySelector('[data-testid="terminal-output-activity-indicator"]')).toBeNull()
    expect(container.querySelector('[data-testid="branch-summary-icon"]')).not.toBeNull()
  })

  test('shows the relative commit time without the last commit author', async () => {
    useFakeTimers()
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
          selectedRef={shallowRef<HTMLLIElement | null>(null)}
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
        selectedRef={shallowRef<HTMLLIElement | null>(null)}
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
  return createGitRepoPresentationForTest(
    emptyWorkspace(workspaceIdForTest('goblin+file:///tmp/repo'), 'repo-runtime-test'),
    {
      branches: [],
      currentBranch: '',
      status: [],
    },
  )
}

function markDirty(repo: ReturnType<typeof branchRowRepo>, count: number): void {
  repo.status = [
    {
      path: '/tmp/worktree-a',
      branch: 'feature/a',
      isMain: false,
      entries: Array.from({ length: count }, (_, index) => ({ x: 'M', y: ' ', path: `file-${index}.ts` })),
    },
  ]
}
