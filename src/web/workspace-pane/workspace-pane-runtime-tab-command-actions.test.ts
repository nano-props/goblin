import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  terminalExecutionPath,
  terminalPresentationBranch,
  terminalSessionCoordinates,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import type { TerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  runWorkspacePaneRuntimeNewAction,
  runWorkspacePaneRuntimePrimaryAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-command-actions.ts'
import { createTerminalWithAdmissionForTest } from '#/web/test-utils/terminal-session-command-bridge.ts'
import { resetWorkspacePaneActionQueueForTest } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { runWorkspacePaneAction } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { workspacePaneRuntimeTabCommandContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-command-context.ts'
import { gitWorktreePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { resolveWorkspacePaneTerminalExecutionTarget } from '#/web/workspace-pane/workspace-pane-terminal-execution-target.ts'
import { createRepoBranch, resetWorkspacesStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import {
  captureWorkspacePaneActiveTabIdentity,
  recordWorkspacePaneTabOpener,
  workspacePaneTabOpener,
} from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspacePaneTabsTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'

const terminalBase: TerminalSessionBase = {
  target: {
    kind: 'git-worktree' as const,
    workspaceId: canonicalWorkspaceLocator('goblin+file:///repo')!,
    workspaceRuntimeId: 'repo-runtime-1',
    root: canonicalWorkspaceLocator('goblin+file:///repo-worktree')!,
  },
  presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
}
const terminalPaneTarget = workspacePaneTabsTargetFromRuntime(terminalBase.target)!

const terminalCoordinates = terminalSessionCoordinates(terminalBase)

describe('workspace pane runtime tab command actions', () => {
  beforeEach(() => {
    resetWorkspacePaneActionQueueForTest()
    resetWorkspacesStore()
  })

  test('resolves the ordinary workspace root while pane tabs are still pending', () => {
    const repo = seedRepoWithReadModelForTest({
      id: terminalCoordinates.workspaceId,
      workspaceRuntimeId: terminalCoordinates.workspaceRuntimeId,
      branches: [],
      currentBranchName: null,
    })
    useWorkspacesStore
      .getState()
      .setWorkspacePaneTabForTarget({ kind: 'workspace-root', workspaceId: repo.id }, 'files')

    const workspaceId = canonicalWorkspaceLocator(repo.id)
    if (!workspaceId) throw new Error('expected canonical workspace fixture')
    const target = { kind: 'workspace-root' as const, workspaceId, workspaceRuntimeId: repo.workspaceRuntimeId }
    expect(resolveWorkspacePaneTerminalExecutionTarget(target, { kind: 'workspace-root' })).toEqual({
      target,
      presentation: { kind: 'workspace-root' },
    })
    expect(
      captureWorkspacePaneActiveTabIdentity({ kind: 'workspace-root', workspaceId: repo.id }, repo.workspaceRuntimeId, {
        workspacePaneRoute: undefined,
      }),
    ).toBeNull()
    expect(
      recordWorkspacePaneTabOpener(
        { kind: 'workspace-root', workspaceId: repo.id },
        repo.workspaceRuntimeId,
        'terminal:term-111111111111111111111',
        'workspace-pane:files',
      ),
    ).toBe('recorded')
    expect(
      workspacePaneTabOpener(
        { kind: 'workspace-root', workspaceId: repo.id },
        repo.workspaceRuntimeId,
        'terminal:term-111111111111111111111',
      ),
    ).toBe('workspace-pane:files')
  })

  test('resolves a Git worktree execution target while pane tabs are still pending', () => {
    const branchName = terminalPresentationBranch(terminalBase.presentation)
    if (!branchName) throw new Error('expected Git worktree terminal fixture')
    seedRepoWithReadModelForTest({
      id: terminalCoordinates.workspaceId,
      workspaceRuntimeId: terminalCoordinates.workspaceRuntimeId,
      branches: [createRepoBranch(branchName, { worktree: { path: terminalExecutionPath(terminalBase.target) } })],
      currentBranchName: branchName,
    })

    expect(resolveWorkspacePaneTerminalExecutionTarget(terminalBase.target, terminalBase.presentation)).toEqual(
      terminalBase,
    )
    expect(
      captureWorkspacePaneActiveTabIdentity(terminalPaneTarget, terminalCoordinates.workspaceRuntimeId, {
        workspacePaneRoute: undefined,
      }),
    ).toBeNull()
  })

  test('routes a committed create with its canonical admission branch', async () => {
    const branchName = terminalPresentationBranch(terminalBase.presentation)
    if (!branchName) throw new Error('expected Git worktree terminal fixture')
    seedRepoWithReadModelForTest({
      id: terminalCoordinates.workspaceId,
      workspaceRuntimeId: terminalCoordinates.workspaceRuntimeId,
      branches: [createRepoBranch(branchName, { worktree: { path: terminalExecutionPath(terminalBase.target) } })],
      currentBranchName: branchName,
    })
    const showCreatedRuntimeTab = vi.fn(() => true)
    const context = workspacePaneRuntimeTabCommandContext({
      filesystemTarget:
        terminalBase.target.kind === 'git-worktree'
          ? gitWorktreePaneFilesystemTarget({
              workspaceId: terminalBase.target.workspaceId,
              workspaceRuntimeId: terminalBase.target.workspaceRuntimeId,
              worktreePath: terminalExecutionPath(terminalBase.target),
              head:
                terminalBase.presentation.kind === 'git-worktree'
                  ? terminalBase.presentation.head
                  : { kind: 'detached' },
              capabilities: {
                files: { read: true, write: true },
                terminal: { available: true },
                git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
              },
            })
          : null,
      workspaceId: terminalCoordinates.workspaceId,
      branchName: terminalPresentationBranch(terminalBase.presentation),
      workspacePaneRoute: null,
      showRuntimeTab: vi.fn(() => true),
      showCreatedRuntimeTab,
    })

    await context.terminal?.showCreatedTerminalSession('term-111111111111111111111', {
      kind: 'git-worktree' as const,
      head: { kind: 'branch', branchName: 'feature/renamed' },
    })

    expect(showCreatedRuntimeTab).toHaveBeenCalledWith(
      'terminal',
      'term-111111111111111111111',
      { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'feature/renamed' } },
      terminalExecutionPath(terminalBase.target),
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
        kind: 'git-worktree' as const,
        workspaceId: terminalCoordinates.workspaceId,
        workspaceRuntimeId: terminalCoordinates.workspaceRuntimeId,
        worktreePath: terminalExecutionPath(terminalBase.target),
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
      presentation: terminalBase.presentation,
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
