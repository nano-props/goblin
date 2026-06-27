// @vitest-environment jsdom

// Unit tests for the presentational BranchList. Its contract is
// "given branches + a highlighted name + callbacks, paint rows and
// bubble events up". We stub BranchActionsMenu and the terminal bell
// hook so the suite stays focused on the list.

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchList } from '#/web/components/branch-navigator/BranchList.tsx'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { createRepoBranch } from '#/web/test-utils/bridge.ts'

vi.mock('#/web/stores/i18n.ts', () => ({
  useI18nStore: (selector: (state: { lang: string }) => string) => selector({ lang: 'zh' }),
  useT: () => (key: string) => key,
}))

vi.mock('#/web/components/BranchActionsMenu.tsx', () => ({
  BranchActionsMenu: () => null,
}))

vi.mock('#/web/components/terminal/terminal-session-store.ts', () => ({
  useWorktreeTerminalBellCount: () => 0,
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
  vi.clearAllMocks()
})

describe('BranchList', () => {
  test('renders one row per branch and forwards click/double-click', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    const branches = [createRepoBranch('main'), createRepoBranch('feature/a'), createRepoBranch('fix/b')]
    const onSelect = vi.fn()
    const onOpenStatus = vi.fn()

    render(
      <BranchList
        repo={repo}
        branches={branches}
        highlightedBranch="main"
        onSelectBranch={onSelect}
        onOpenBranchStatus={onOpenStatus}
        emptyState={null}
      />,
    )

    const items = Array.from(document.querySelectorAll('li'))
    expect(items).toHaveLength(3)

    act(() => {
      items[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalledWith('feature/a')

    act(() => {
      items[2]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(onOpenStatus).toHaveBeenCalledWith('fix/b')
  })

  test('renders the emptyState slot when branches is empty', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    const onSelect = vi.fn()

    render(
      <BranchList
        repo={repo}
        branches={[]}
        highlightedBranch={null}
        onSelectBranch={onSelect}
        onOpenBranchStatus={() => {}}
        emptyState={<div data-testid="empty">nothing here</div>}
      />,
    )

    expect(document.querySelector('ul')).toBeNull()
    expect(document.querySelector('[data-testid="empty"]')?.textContent).toBe('nothing here')
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('renders the emptyState slot when repo is null', () => {
    // `branches` is non-empty so the `!repo` branch is the one that
    // short-circuits — passing `branches={[]}` would exercise the
    // empty-list early-return instead.
    render(
      <BranchList
        repo={null}
        branches={[createRepoBranch('main')]}
        highlightedBranch={null}
        onSelectBranch={() => {}}
        onOpenBranchStatus={() => {}}
        emptyState={<div data-testid="empty">repo not loaded</div>}
      />,
    )

    expect(document.querySelector('ul')).toBeNull()
    expect(document.querySelector('[data-testid="empty"]')?.textContent).toBe('repo not loaded')
  })

  test('highlights the row whose name matches highlightedBranch', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    const branches = [createRepoBranch('main'), createRepoBranch('feature/a'), createRepoBranch('fix/b')]

    render(
      <BranchList
        repo={repo}
        branches={branches}
        highlightedBranch="fix/b"
        onSelectBranch={() => {}}
        onOpenBranchStatus={() => {}}
        emptyState={null}
      />,
    )

    const items = Array.from(document.querySelectorAll('li'))
    expect(items[2]?.className).toContain('bg-selected')
    expect(items[0]?.className).not.toContain('bg-selected')
    expect(items[1]?.className).not.toContain('bg-selected')
  })
})

function render(element: ReactNode) {
  act(() => {
    root!.render(element)
  })
}
