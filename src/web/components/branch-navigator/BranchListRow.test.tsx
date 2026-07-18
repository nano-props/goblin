// @vitest-environment jsdom

import { createRef } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchListRow } from '#/web/components/branch-navigator/BranchListRow.tsx'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { createGitRepoPresentationForTest, createRepoBranch } from '#/web/test-utils/bridge.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'

// Side-effect import: registers a partial mock of `#/web/stores/i18n.ts`
// that delegates to the real module so `i18next.use(initReactI18next).
// init({…})` still runs (which is what wires the i18next singleton into
// `react-i18next`'s module-scoped closure, the one `<Trans>` reads
// from), and only overrides `useT` to return raw keys. See
// `src/test-utils/i18n-mock.ts` for the rationale and the importOriginal
// pattern that backs this side effect.
import { stubI18n } from '#/test-utils/i18n-mock.ts'
stubI18n()

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => false,
}))

vi.mock('#/web/components/terminal/terminal-session-store.ts', () => ({
  useTerminalWorktreeOutputActive: () => terminalStoreMocks.outputActive,
  useTerminalWorktreeBellCount: () => 0,
}))

const branchRowPropsSpy = vi.fn()
const terminalStoreMocks = vi.hoisted(() => ({
  outputActive: false,
}))

vi.mock('#/web/components/branch-navigator/BranchRow.tsx', () => ({
  BranchRow: (props: unknown) => {
    branchRowPropsSpy(props)
    return null
  },
}))

beforeEach(() => {
  branchRowPropsSpy.mockClear()
  terminalStoreMocks.outputActive = false
})

describe('BranchListRow', () => {
  test('forwards `branchActionBusy=true` when an in-flight branch action targets this branch', () => {
    const repo = branchListRowRepo()
    repo.branchAction = { ...repo.branchAction, phase: 'running', target: 'feature/a' }
    renderInJsdom(<BranchListRow {...baseProps(repo, 'feature/a')} />)
    expect(branchRowPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ branchActionBusy: true }))
  })

  test('forwards `branchActionBusy=false` when an in-flight branch action targets a different branch', () => {
    const repo = branchListRowRepo()
    repo.branchAction = { ...repo.branchAction, phase: 'running', target: 'feature/other' }
    renderInJsdom(<BranchListRow {...baseProps(repo, 'feature/a')} />)
    expect(branchRowPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ branchActionBusy: false }))
  })

  test('forwards `branchActionBusy=false` when the operations state is idle', () => {
    const repo = branchListRowRepo()
    renderInJsdom(<BranchListRow {...baseProps(repo, 'feature/a')} />)
    expect(branchRowPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ branchActionBusy: false }))
  })

  test('forwards terminal output activity from the worktree terminal snapshot', () => {
    terminalStoreMocks.outputActive = true
    const repo = branchListRowRepo()
    renderInJsdom(<BranchListRow {...baseProps(repo, 'feature/a')} />)
    expect(branchRowPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ terminalOutputActive: true }))
  })
})

function baseProps(
  repo: BranchActionRepo,
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

function branchListRowRepo(): BranchActionRepo {
  const repo = createGitRepoPresentationForTest(emptyWorkspace('/tmp/repo', 'repo', 'repo-runtime-test'), {
    branches: [],
    currentBranch: '',
    status: [],
    worktreesByPath: {},
  })
  return {
    id: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    branchModel: repo.branchModel,
    branchAction: repo.operations.branchAction,
    remote: repo.remote,
    remoteLifecycle: repo.remoteLifecycle,
  }
}
