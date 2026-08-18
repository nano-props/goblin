// @vitest-environment jsdom

import {
  createRepoBranch,
  createGitRepoPresentationForTest,
  createRepoWorktreeSnapshotForTest,
} from '#/web/test-utils/repo-store.ts'
import { shallowRef } from 'vue'
import type { ComponentProps } from 'vue-component-type-helpers'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GitWorkspaceNavigatorBranchRow } from '#/web/components/workspace-navigator/GitWorkspaceNavigatorBranchRow.tsx'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => ({ value: false }),
}))

vi.mock('#/web/terminal/components/terminal-session-store.ts', () => ({
  useTerminalFilesystemTargetOutputActive: (targetKey: { readonly value: string | null }) => {
    terminalStoreMocks.targetKey = targetKey
    return {
      get value() {
        return terminalStoreMocks.outputActive
      },
    }
  },
  useTerminalFilesystemTargetBellCount: () => ({ value: 0 }),
}))

const branchRowPropsSpy = vi.fn()
const terminalStoreMocks = vi.hoisted(() => ({
  outputActive: false,
  targetKey: null as { readonly value: string | null } | null,
}))

vi.mock('#/web/components/workspace-navigator/BranchRow.tsx', () => ({
  BranchRow: (props: unknown) => {
    branchRowPropsSpy(props)
    return null
  },
}))

beforeEach(() => {
  branchRowPropsSpy.mockClear()
  terminalStoreMocks.outputActive = false
  terminalStoreMocks.targetKey = null
})

describe('GitWorkspaceNavigatorBranchRow', () => {
  test('forwards `branchActionBusy=true` when an in-flight branch action targets this branch', () => {
    const repo = branchListRowRepo()
    repo.branchAction = { ...repo.branchAction, phase: 'running', target: 'feature/a' }
    renderInJsdom(<GitWorkspaceNavigatorBranchRow {...baseProps(repo, 'feature/a')} />)
    expect(branchRowPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ branchActionBusy: true }))
  })

  test('forwards `branchActionBusy=false` when an in-flight branch action targets a different branch', () => {
    const repo = branchListRowRepo()
    repo.branchAction = { ...repo.branchAction, phase: 'running', target: 'feature/other' }
    renderInJsdom(<GitWorkspaceNavigatorBranchRow {...baseProps(repo, 'feature/a')} />)
    expect(branchRowPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ branchActionBusy: false }))
  })

  test('forwards `branchActionBusy=false` when the operations state is idle', () => {
    const repo = branchListRowRepo()
    renderInJsdom(<GitWorkspaceNavigatorBranchRow {...baseProps(repo, 'feature/a')} />)
    expect(branchRowPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ branchActionBusy: false }))
  })

  test('forwards terminal output activity from the worktree terminal snapshot', () => {
    terminalStoreMocks.outputActive = true
    const repo = branchListRowRepo()
    renderInJsdom(<GitWorkspaceNavigatorBranchRow {...baseProps(repo, 'feature/a')} />)
    expect(branchRowPropsSpy).toHaveBeenCalledWith(expect.objectContaining({ terminalOutputActive: true }))
  })

  test('subscribes a source row through the workspace-root terminal owner', () => {
    const repo = branchListRowRepo()
    repo.snapshot = {
      ...repo.snapshot,
      worktrees: [
        createRepoWorktreeSnapshotForTest('main', '/private/tmp/repo-real', {
          isSource: true,
          isPrimary: true,
        }),
      ],
    }

    renderInJsdom(<GitWorkspaceNavigatorBranchRow {...baseProps(repo, 'main')} />)

    expect(terminalStoreMocks.targetKey?.value).toBe(formatTerminalFilesystemTargetKeyForPath(repo.id, repo.id))
  })
})

function baseProps(
  repo: BranchActionRepo,
  branchName: string,
): Omit<ComponentProps<typeof GitWorkspaceNavigatorBranchRow>, 'terminalBellCount' | 'branchActionBusy'> {
  return {
    repo,
    branch: createRepoBranch(branchName),
    selected: null,
    onSelectBranch: vi.fn(),
    onOpenBranchStatus: vi.fn(),
    selectedRef: shallowRef<HTMLLIElement | null>(null),
    onActionMenuOpenChange: vi.fn(),
  }
}

function branchListRowRepo(): BranchActionRepo {
  const repo = createGitRepoPresentationForTest(
    emptyWorkspace(workspaceIdForTest('goblin+file:///tmp/repo'), 'repo-runtime-test'),
    {
      branches: [],
      currentBranch: '',
      status: [],
    },
  )
  return {
    id: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    snapshot: repo.snapshot,
    status: repo.status,
    branchAction: repo.operations.branchAction,
    remoteLifecycle: repo.remoteLifecycle,
  }
}
