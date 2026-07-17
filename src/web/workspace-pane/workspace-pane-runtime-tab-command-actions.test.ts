import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type { TerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  runWorkspacePaneRuntimeNewAction,
  runWorkspacePaneRuntimePrimaryAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-command-actions.ts'
import { createTerminalWithAdmissionForTest } from '#/web/test-utils/terminal-session-command-bridge.ts'
import { resetWorkspacePaneActionQueueForTest } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { runWorkspacePaneAction } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { workspacePaneRuntimeTabCommandContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-command-context.ts'
import { createRepoBranch, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'

const terminalBase: TerminalSessionBase & { repoRuntimeId: string } = {
  repoRoot: 'goblin+file:///repo',
  repoRuntimeId: 'repo-runtime-1',
  branch: 'main',
  worktreePath: '/repo-worktree',
}

describe('workspace pane runtime tab command actions', () => {
  beforeEach(() => {
    resetWorkspacePaneActionQueueForTest()
    resetReposStore()
  })

  test('routes a committed create with its canonical admission branch', async () => {
    seedRepoWithReadModelForTest({
      id: terminalBase.repoRoot,
      repoRuntimeId: terminalBase.repoRuntimeId,
      branches: [createRepoBranch(terminalBase.branch, { worktree: { path: terminalBase.worktreePath } })],
      currentBranchName: terminalBase.branch,
      workspacePaneTabsByBranch: { [terminalBase.branch]: [workspacePaneStaticTabEntry('status')] },
    })
    const showCreatedRuntimeTab = vi.fn(() => true)
    const context = workspacePaneRuntimeTabCommandContext({
      repoId: terminalBase.repoRoot,
      branchName: terminalBase.branch,
      workspacePaneRoute: null,
      showRuntimeTab: vi.fn(() => true),
      showCreatedRuntimeTab,
    })

    await context.terminal?.showCreatedTerminalSession('term-111111111111111111111', 'feature/renamed')

    expect(showCreatedRuntimeTab).toHaveBeenCalledWith(
      'terminal',
      'term-111111111111111111111',
      'feature/renamed',
      terminalBase.worktreePath,
    )
  })

  test('primary terminal action focuses the first existing runtime session', async () => {
    const createTerminal = vi.fn(async () => 'created-session')
    const selectTerminal = vi.fn()
    const showTerminalSession = vi.fn(() => true)
    const bridge: TerminalSessionCommandBridge = {
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: '/repo\0/repo-worktree',
        selectedDescriptor: null,
        sessions: [
          terminalSession('term-111111111111111111111', true),
          terminalSession('term-222222222222222222222', false),
        ],
        count: 2,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: false,
      }),
      createTerminal,
      createTerminalWithAdmission: createTerminalWithAdmissionForTest(createTerminal),
      selectTerminal,
    }

    await expect(
      runWorkspacePaneRuntimePrimaryAction('terminal', {
        terminal: {
          base: terminalBase,
          bridge,
          openerIdentity: null,
          showTerminalSession,
          showCreatedTerminalSession: showTerminalSession,
        },
      }),
    ).resolves.toBe(true)

    expect(showTerminalSession).toHaveBeenCalledWith('term-111111111111111111111')
    expect(selectTerminal).not.toHaveBeenCalled()
    expect(createTerminal).not.toHaveBeenCalled()
  })

  test('primary terminal action queues existing-session focus behind workspace pane coordination', async () => {
    let releaseCoordinator!: () => void
    let markCoordinatorStarted!: () => void
    const coordinatorStarted = new Promise<void>((resolve) => {
      markCoordinatorStarted = resolve
    })
    const coordinatorBlocker = runWorkspacePaneAction(
      {
        repoId: terminalBase.repoRoot,
        repoRuntimeId: terminalBase.repoRuntimeId,
        branchName: terminalBase.branch,
        worktreePath: terminalBase.worktreePath,
      },
      async () => {
        markCoordinatorStarted()
        await new Promise<void>((resolve) => {
          releaseCoordinator = resolve
        })
      },
    )
    await coordinatorStarted

    let sessions = [terminalSession('term-111111111111111111111', true)]
    const createTerminal = vi.fn(async () => 'created-session')
    const selectTerminal = vi.fn()
    const showTerminalSession = vi.fn(() => true)
    const bridge: TerminalSessionCommandBridge = {
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: '/repo\0/repo-worktree',
        selectedDescriptor: null,
        sessions,
        count: sessions.length,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: false,
      }),
      createTerminal,
      createTerminalWithAdmission: createTerminalWithAdmissionForTest(createTerminal),
      selectTerminal,
    }

    const actionPromise = runWorkspacePaneRuntimePrimaryAction('terminal', {
      terminal: {
        base: terminalBase,
        bridge,
        openerIdentity: null,
        showTerminalSession,
        showCreatedTerminalSession: showTerminalSession,
      },
    })
    await Promise.resolve()

    expect(showTerminalSession).not.toHaveBeenCalled()

    sessions = [terminalSession('term-222222222222222222222', true)]
    releaseCoordinator()
    await coordinatorBlocker

    await expect(actionPromise).resolves.toBe(true)
    expect(showTerminalSession).toHaveBeenCalledWith('term-222222222222222222222')
    expect(selectTerminal).not.toHaveBeenCalled()
    expect(createTerminal).not.toHaveBeenCalled()
  })

  test('primary terminal action does not enqueue a plain create while the first terminal is pending', async () => {
    const createTerminal = vi.fn(async () => 'created-session')
    const showTerminalSession = vi.fn(() => true)
    const bridge: TerminalSessionCommandBridge = {
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: '/repo\0/repo-worktree',
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: true,
      }),
      createTerminal,
      createTerminalWithAdmission: createTerminalWithAdmissionForTest(createTerminal),
      selectTerminal: vi.fn(),
    }

    await expect(
      runWorkspacePaneRuntimePrimaryAction('terminal', {
        terminal: {
          base: terminalBase,
          bridge,
          openerIdentity: null,
          showTerminalSession,
          showCreatedTerminalSession: showTerminalSession,
        },
      }),
    ).resolves.toBe(true)

    expect(showTerminalSession).not.toHaveBeenCalled()
    expect(createTerminal).not.toHaveBeenCalled()
  })

  test('new terminal action joins a pending duplicate create through terminal ownership', async () => {
    const createTerminal = vi.fn(async () => 'created-session')
    const createTerminalWithAdmission = vi.fn(async () => ({
      terminalSessionId: 'created-session',
      branch: terminalBase.branch,
      requestRole: 'observer' as const,
      resourceDisposition: 'created' as const,
      runtimeProjectionApplied: true,
    }))
    const showTerminalSession = vi.fn(() => true)
    const bridge: TerminalSessionCommandBridge = {
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: '/repo\0/repo-worktree',
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: true,
      }),
      createTerminal,
      createTerminalWithAdmission,
      selectTerminal: vi.fn(),
    }

    await expect(
      runWorkspacePaneRuntimeNewAction('terminal', {
        terminal: {
          base: terminalBase,
          bridge,
          openerIdentity: null,
          showTerminalSession,
          showCreatedTerminalSession: showTerminalSession,
        },
      }),
    ).resolves.toBe(true)

    expect(showTerminalSession).not.toHaveBeenCalled()
    expect(createTerminalWithAdmission).toHaveBeenCalledWith(terminalBase, undefined)
    expect(createTerminal).not.toHaveBeenCalled()
  })

  test('primary terminal action rejects when no bridge is available', async () => {
    const showTerminalSession = vi.fn(() => true)

    await expect(
      runWorkspacePaneRuntimePrimaryAction('terminal', {
        terminal: {
          base: terminalBase,
          bridge: null,
          openerIdentity: null,
          showTerminalSession,
          showCreatedTerminalSession: showTerminalSession,
        },
      }),
    ).resolves.toBe(false)

    expect(showTerminalSession).not.toHaveBeenCalled()
  })

  test('new terminal action rejects when no runtime base is available', async () => {
    await expect(
      runWorkspacePaneRuntimeNewAction('terminal', {
        terminal: {
          base: null,
          bridge: null,
          openerIdentity: null,
          showTerminalSession: vi.fn(),
          showCreatedTerminalSession: vi.fn(),
        },
      }),
    ).resolves.toBe(false)
  })
})

function terminalSession(terminalSessionId: string, selected: boolean) {
  return {
    type: 'terminal' as const,
    terminalSessionId,
    terminalWorktreeKey: '/repo\0/repo-worktree',
    index: terminalSessionId === 'term-111111111111111111111' ? 1 : 2,
    title: terminalSessionId,
    fullTitle: terminalSessionId,
    originalTitle: terminalSessionId,
    phase: 'open' as const,
    selected,
    hasBell: false,
    hasRecentOutput: false,
  }
}
