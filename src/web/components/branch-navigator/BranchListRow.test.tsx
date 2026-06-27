// @vitest-environment jsdom

import { createRef } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchListRow } from '#/web/components/branch-navigator/BranchListRow.tsx'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { createRepoBranch } from '#/web/test-utils/bridge.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

vi.mock('#/web/stores/i18n.ts', () => ({
  useI18nStore: (selector: (state: { lang: string }) => string) => selector({ lang: 'zh' }),
  useT: () => (key: string) => key,
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => false,
}))

vi.mock('#/web/components/terminal/terminal-session-store.ts', () => ({
  useWorktreeTerminalBellCount: () => 0,
}))

const branchRowPropsSpy = vi.fn()

vi.mock('#/web/components/branch-navigator/BranchRow.tsx', () => ({
  BranchRow: (props: unknown) => {
    branchRowPropsSpy(props)
    return null
  },
}))

beforeEach(() => {
  branchRowPropsSpy.mockClear()
})

describe('BranchListRow', () => {
  test('forwards `branchActionBusy=true` when an in-flight branch action targets this branch', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    repo.operations.branchAction = { ...repo.operations.branchAction, phase: 'running', target: 'feature/a' }
    renderInJsdom(<BranchListRow {...baseProps(repo, 'feature/a')} />)
    expect(branchRowPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ branchActionBusy: true }))
  })

  test('forwards `branchActionBusy=false` when an in-flight branch action targets a different branch', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    repo.operations.branchAction = { ...repo.operations.branchAction, phase: 'running', target: 'feature/other' }
    renderInJsdom(<BranchListRow {...baseProps(repo, 'feature/a')} />)
    expect(branchRowPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ branchActionBusy: false }))
  })

  test('forwards `branchActionBusy=false` when the operations state is idle', () => {
    const repo = emptyRepo('/tmp/repo', 'repo')
    renderInJsdom(<BranchListRow {...baseProps(repo, 'feature/a')} />)
    expect(branchRowPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ branchActionBusy: false }))
  })
})

function baseProps(
  repo: ReturnType<typeof emptyRepo>,
  branchName: string,
): Omit<React.ComponentProps<typeof BranchListRow>, 'terminalBellCount' | 'branchActionBusy'> {
  return {
    repo,
    branch: createRepoBranch(branchName),
    selected: null,
    onSelectBranch: vi.fn(),
    onOpenBranchStatus: vi.fn(),
    selectedRef: createRef<HTMLLIElement>(),
    onActionMenuOpenChange: vi.fn(),
  }
}
