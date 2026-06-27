// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { dispatchRemoveWorktree } from '#/web/hooks/branchActionDispatch.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { WorktreeTerminalSnapshot } from '#/web/components/terminal/types.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneStaticTabOrderEntry } from '#/shared/workspace-pane.ts'

const REPO_ID = '/tmp/gbl-branch-action-dispatch-repo'
const WORKTREE_PATH = '/tmp/gbl-branch-action-dispatch-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

beforeEach(() => {
  resetReposStore()
})

afterEach(() => {
  setTerminalSessionCommandBridge(null)
  resetReposStore()
})

describe('branch action dispatch', () => {
  test('remove worktree waits for workspace tab resources before dispatching repo action', async () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [workspacePaneStaticTabOrderEntry('status'), { type: 'terminal', id: 'slot-1' }],
      },
    })
    const calls: string[] = []
    const runBranchAction = vi.fn(async () => {
      calls.push('runBranchAction')
      return { ok: true, message: 'ok' }
    })
    useReposStore.setState({ runBranchAction })
    let resolveClose!: (value: boolean) => void
    const closeTerminalsForWorktree = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          calls.push('closeTerminal')
          resolveClose = resolve
        }),
    )
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'slot-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
      closeTerminalsForWorktree,
    })

    const pending = dispatchRemoveWorktree({
      repo,
      target: { branch: 'feature/worktree', path: WORKTREE_PATH },
      alsoDeleteBranch: false,
      forceDeleteBranch: false,
      alsoDeleteUpstream: false,
    })
    await Promise.resolve()

    expect(calls).toEqual(['closeTerminal'])
    expect(runBranchAction).not.toHaveBeenCalled()

    resolveClose(true)
    await expect(pending).resolves.toEqual({ ok: true, message: 'ok' })

    expect(calls).toEqual(['closeTerminal', 'runBranchAction'])
    expect(runBranchAction).toHaveBeenCalledWith(
      REPO_ID,
      {
        kind: 'removeWorktree',
        branch: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        alsoDeleteBranch: false,
        forceDeleteBranch: false,
        alsoDeleteUpstream: false,
      },
      {
        token: repo.instanceToken,
        deferResultMessages: [],
      },
    )
  })

  test('remove worktree stops when workspace tab resources fail to close', async () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [workspacePaneStaticTabOrderEntry('status'), { type: 'terminal', id: 'slot-1' }],
      },
    })
    const runBranchAction = vi.fn(async () => ({ ok: true, message: 'ok' }))
    useReposStore.setState({ runBranchAction })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'slot-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
      closeTerminalsForWorktree: vi.fn(async () => false),
    })

    await expect(
      dispatchRemoveWorktree({
        repo,
        target: { branch: 'feature/worktree', path: WORKTREE_PATH },
        alsoDeleteBranch: true,
        forceDeleteBranch: false,
        alsoDeleteUpstream: true,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.workspace-tab-close-failed' })

    expect(runBranchAction).not.toHaveBeenCalled()
    expect(useReposStore.getState().repos[REPO_ID]?.events.at(-1)).toMatchObject({
      kind: 'result',
      result: { ok: false, message: 'error.workspace-tab-close-failed' },
      action: {
        kind: 'removeWorktree',
        branch: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        alsoDeleteBranch: true,
      },
    })
  })

  test('remove worktree proceeds when no workspace tabs are open', async () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
      workspacePaneTabOrderByBranch: {},
    })
    const runBranchAction = vi.fn(async () => ({ ok: true, message: 'ok' }))
    useReposStore.setState({ runBranchAction })
    const closeTerminalsForWorktree = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'slot-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
      closeTerminalsForWorktree,
    })

    await expect(
      dispatchRemoveWorktree({
        repo,
        target: { branch: 'feature/worktree', path: WORKTREE_PATH },
        alsoDeleteBranch: false,
        forceDeleteBranch: false,
        alsoDeleteUpstream: false,
      }),
    ).resolves.toEqual({ ok: true, message: 'ok' })

    expect(runBranchAction).toHaveBeenCalled()
  })

  test('remove worktree does not close workspace tabs when local preflight already knows it is dirty', async () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [workspacePaneStaticTabOrderEntry('status'), { type: 'terminal', id: 'slot-1' }],
      },
      worktreesByPath: {
        [WORKTREE_PATH]: {
          path: WORKTREE_PATH,
          branch: 'feature/worktree',
          isMain: false,
          isDirty: true,
        },
      },
    })
    const runBranchAction = vi.fn(async () => ({ ok: true, message: 'ok' }))
    const closeTerminalsForWorktree = vi.fn(async () => true)
    useReposStore.setState({ runBranchAction })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'slot-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
      closeTerminalsForWorktree,
    })

    await expect(
      dispatchRemoveWorktree({
        repo,
        target: { branch: 'feature/worktree', path: WORKTREE_PATH },
        alsoDeleteBranch: false,
        forceDeleteBranch: false,
        alsoDeleteUpstream: false,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.cannot-remove-dirty-worktree' })

    expect(closeTerminalsForWorktree).not.toHaveBeenCalled()
    expect(runBranchAction).not.toHaveBeenCalled()
  })
})

function emptyWorktreeSnapshot(): WorktreeTerminalSnapshot {
  return {
    worktreeTerminalKey: WORKTREE_KEY,
    selectedDescriptor: null,
    sessions: [],
    count: 0,
    bellCount: 0,
    pendingCreate: false,
  }
}

function worktreeSnapshotWithTerminal(): WorktreeTerminalSnapshot {
  return {
    worktreeTerminalKey: WORKTREE_KEY,
    selectedDescriptor: {
      key: 'slot-1',
      worktreeTerminalKey: WORKTREE_KEY,
      slotId: 'slot-1',
      index: 1,
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    },
    sessions: [
      {
        type: 'terminal',
        id: 'slot-1',
        key: 'slot-1',
        worktreeTerminalKey: WORKTREE_KEY,
        slotId: 'slot-1',
        index: 1,
        displayOrder: 1,
        title: 'terminal 1',
        phase: 'open',
        selected: true,
        hasBell: false,
      },
    ],
    count: 1,
    bellCount: 0,
    pendingCreate: false,
  }
}
