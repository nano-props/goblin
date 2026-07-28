import { resetWorkspacesStore, seedRepoWithReadModelForTest, createRepoBranch } from '#/web/test-utils/repo-store.ts'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  terminalExecutionPath,
  terminalPresentationBranch,
  terminalSessionCoordinates,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import type { TerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { TerminalFocusRequest } from '#/web/components/terminal/types.ts'
import {
  runWorkspacePaneRuntimeNewAction,
  runWorkspacePaneRuntimePrimaryAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-command-actions.ts'
import type { CreatedTerminalRouteRequest } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import { createTerminalWithAdmissionForTest } from '#/web/test-utils/terminal-session-command-bridge.ts'
import {
  resetWorkspacePaneActionQueueForTest,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { workspacePaneRuntimeTabCommandContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-command-context.ts'
import { gitWorktreePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import {
  captureWorkspacePaneActiveTabIdentity,
  recordWorkspacePaneTabOpener,
  workspacePaneTabOpener,
} from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspacePaneTabsTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'
import {
  beginAppNavigation,
  appNavigationIsCurrent,
  resetAppNavigationForTest,
} from '#/web/app-navigation-lifecycle.ts'
import { resetTerminalAutoFocusForTest } from '#/web/terminal-focus.ts'

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
const terminalRouteTarget = {
  kind: 'git-branch' as const,
  workspaceId: terminalBase.target.workspaceId,
  branchName: 'main',
}

const terminalCoordinates = terminalSessionCoordinates(terminalBase)

describe('workspace pane runtime tab command actions', () => {
  beforeEach(() => {
    resetTerminalAutoFocusForTest()
    resetWorkspacePaneActionQueueForTest()
    resetWorkspacesStore()
    resetAppNavigationForTest()
  })

  afterEach(() => {
    resetTerminalAutoFocusForTest()
    document.body.replaceChildren()
  })

  test('preserves the ordinary workspace root opener while pane tabs are still pending', () => {
    const repo = seedRepoWithReadModelForTest({
      id: terminalCoordinates.workspaceId,
      workspaceRuntimeId: terminalCoordinates.workspaceRuntimeId,
      branches: [],
      currentBranchName: null,
    })
    useWorkspacesStore
      .getState()
      .setWorkspacePaneTabForTarget({ kind: 'workspace-root', workspaceId: repo.id }, 'files')

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

  test('preserves a Git worktree target while pane tabs are still pending', () => {
    const branchName = terminalPresentationBranch(terminalBase.presentation)
    if (!branchName) throw new Error('expected Git worktree terminal fixture')
    seedRepoWithReadModelForTest({
      id: terminalCoordinates.workspaceId,
      workspaceRuntimeId: terminalCoordinates.workspaceRuntimeId,
      branches: [
        createRepoBranch(branchName, {
          worktree: { path: terminalExecutionPath(terminalBase.target), isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: branchName,
    })

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
      branches: [
        createRepoBranch(branchName, {
          worktree: { path: terminalExecutionPath(terminalBase.target), isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: branchName,
    })
    const showCreatedRuntimeTab = vi.fn(() => true)
    const routeRequest = createdTerminalRouteRequest()
    const context = workspacePaneRuntimeTabCommandContext({
      routeTarget: terminalRouteTarget,
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

    await context.terminal?.showCreatedTerminalSession(
      'term-111111111111111111111',
      {
        kind: 'git-worktree' as const,
        head: { kind: 'branch', branchName: 'feature/renamed' },
      },
      routeRequest,
    )

    expect(showCreatedRuntimeTab).toHaveBeenCalledWith(
      'terminal',
      'term-111111111111111111111',
      { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'feature/renamed' } },
      terminalExecutionPath(terminalBase.target),
      routeRequest,
    )
  })

  test('primary terminal action focuses the first existing runtime session', async () => {
    const createTerminal = vi.fn(async () => 'created-session')
    const selectTerminal = vi.fn()
    const showTerminalSession = vi.fn(() => true)
    const bridge: TerminalSessionCommandBridge = {
      terminalFilesystemTargetSnapshot: () => ({
        terminalFilesystemTargetKey: '/repo\0/repo-worktree',
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
      focusTerminal: vi.fn(),
    }

    await expect(
      runWorkspacePaneRuntimePrimaryAction('terminal', {
        terminal: {
          routeTarget: terminalRouteTarget,
          base: terminalBase,
          bridge,
          openerIdentity: null,
          showTerminalSession,
          showCreatedTerminalSession: showTerminalSession,
        },
      }),
    ).resolves.toBe(true)

    expect(showTerminalSession).toHaveBeenCalledWith(
      'term-111111111111111111111',
      expect.objectContaining({
        navigationGeneration: expect.any(Number),
        onCommit: expect.any(Function),
        onAbandon: expect.any(Function),
      }),
    )
    expect(selectTerminal).not.toHaveBeenCalled()
    expect(createTerminal).not.toHaveBeenCalled()
  })

  test('primary terminal action preserves DOM focus until the committed terminal accepts focus', async () => {
    const actionTarget = document.createElement('button')
    document.body.appendChild(actionTarget)
    actionTarget.focus()
    const focusTerminal = vi.fn((_terminalSessionId: string, _request?: TerminalFocusRequest) => true)
    const showTerminalSession = vi.fn((_sessionId, routeRequest) => {
      expect(document.activeElement).toBe(actionTarget)
      routeRequest.onCommit()
      return true
    })
    const createTerminal = vi.fn(async () => 'created-session')
    const bridge: TerminalSessionCommandBridge = {
      terminalFilesystemTargetSnapshot: () => ({
        terminalFilesystemTargetKey: '/repo\0/repo-worktree',
        selectedDescriptor: null,
        sessions: [terminalSession('term-111111111111111111111', true)],
        count: 1,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: false,
      }),
      createTerminal,
      createTerminalWithAdmission: createTerminalWithAdmissionForTest(createTerminal),
      selectTerminal: vi.fn(),
      focusTerminal,
    }

    await expect(
      runWorkspacePaneRuntimePrimaryAction('terminal', {
        terminal: {
          routeTarget: terminalRouteTarget,
          base: terminalBase,
          bridge,
          openerIdentity: null,
          showTerminalSession,
          showCreatedTerminalSession: showTerminalSession,
        },
      }),
    ).resolves.toBe(true)

    expect(focusTerminal).toHaveBeenCalledWith(
      'term-111111111111111111111',
      expect.objectContaining({ isCurrent: expect.any(Function), onSettled: expect.any(Function) }),
    )
    const focusRequest = focusTerminal.mock.calls[0]![1]
    if (!focusRequest) throw new Error('missing focus request')
    expect(focusRequest.isCurrent()).toBe(true)
    expect(document.activeElement).toBe(actionTarget)

    focusRequest.onSettled?.()
  })

  test('primary terminal action queues existing-session focus behind workspace pane coordination', async () => {
    const coordinatorStarted = Promise.withResolvers<void>()
    const releaseCoordinator = Promise.withResolvers<void>()
    const coordinatorBlocker = runWorkspacePaneAction(
      {
        kind: 'git-worktree' as const,
        workspaceId: terminalCoordinates.workspaceId,
        workspaceRuntimeId: terminalCoordinates.workspaceRuntimeId,
        worktreePath: terminalExecutionPath(terminalBase.target),
      },
      async () => {
        coordinatorStarted.resolve()
        await releaseCoordinator.promise
      },
    )
    await coordinatorStarted.promise

    let sessions = [terminalSession('term-111111111111111111111', true)]
    const createTerminal = vi.fn(async () => 'created-session')
    const selectTerminal = vi.fn()
    const showTerminalSession = vi.fn((_sessionId, routeRequest) =>
      appNavigationIsCurrent(routeRequest.navigationGeneration),
    )
    const terminalFilesystemTargetSnapshot = vi.fn(() => ({
      terminalFilesystemTargetKey: '/repo\0/repo-worktree',
      selectedDescriptor: null,
      sessions,
      count: sessions.length,
      bellCount: 0,
      outputActiveCount: 0,
      createPending: false,
    }))
    const bridge: TerminalSessionCommandBridge = {
      terminalFilesystemTargetSnapshot,
      createTerminal,
      createTerminalWithAdmission: createTerminalWithAdmissionForTest(createTerminal),
      selectTerminal,
      focusTerminal: vi.fn(),
    }

    const actionPromise = runWorkspacePaneRuntimePrimaryAction('terminal', {
      terminal: {
        routeTarget: terminalRouteTarget,
        base: terminalBase,
        bridge,
        openerIdentity: null,
        showTerminalSession,
        showCreatedTerminalSession: showTerminalSession,
      },
    })

    expect(terminalFilesystemTargetSnapshot).toHaveBeenCalledOnce()
    expect(showTerminalSession).not.toHaveBeenCalled()

    sessions = [terminalSession('term-222222222222222222222', true)]
    beginAppNavigation()
    releaseCoordinator.resolve()
    await coordinatorBlocker

    await expect(actionPromise).resolves.toBe(false)
    expect(terminalFilesystemTargetSnapshot).toHaveBeenCalledTimes(2)
    expect(showTerminalSession).toHaveBeenCalledWith(
      'term-222222222222222222222',
      expect.objectContaining({
        navigationGeneration: expect.any(Number),
        onCommit: expect.any(Function),
        onAbandon: expect.any(Function),
      }),
    )
    expect(showTerminalSession).toHaveReturnedWith(false)
    expect(selectTerminal).not.toHaveBeenCalled()
    expect(createTerminal).not.toHaveBeenCalled()
  })

  test('primary terminal action does not enqueue a plain create while the first terminal is pending', async () => {
    const createTerminal = vi.fn(async () => 'created-session')
    const showTerminalSession = vi.fn(() => true)
    const bridge: TerminalSessionCommandBridge = {
      terminalFilesystemTargetSnapshot: () => ({
        terminalFilesystemTargetKey: '/repo\0/repo-worktree',
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
      focusTerminal: vi.fn(),
    }

    const pendingCreatePresentation = beginAppNavigation()
    await expect(
      runWorkspacePaneRuntimePrimaryAction('terminal', {
        terminal: {
          routeTarget: terminalRouteTarget,
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
    expect(appNavigationIsCurrent(pendingCreatePresentation)).toBe(true)
  })

  test('primary terminal action presents an existing session while another create is pending', async () => {
    const showTerminalSession = vi.fn(() => true)
    const bridge: TerminalSessionCommandBridge = {
      terminalFilesystemTargetSnapshot: () => ({
        terminalFilesystemTargetKey: '/repo\0/repo-worktree',
        selectedDescriptor: null,
        sessions: [terminalSession('term-111111111111111111111', true)],
        count: 1,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: true,
      }),
      createTerminal: vi.fn(async () => 'created-session'),
      createTerminalWithAdmission: vi.fn(),
      selectTerminal: vi.fn(),
      focusTerminal: vi.fn(),
    }

    await expect(
      runWorkspacePaneRuntimePrimaryAction('terminal', {
        terminal: {
          routeTarget: terminalRouteTarget,
          base: terminalBase,
          bridge,
          openerIdentity: null,
          showTerminalSession,
          showCreatedTerminalSession: showTerminalSession,
        },
      }),
    ).resolves.toBe(true)

    expect(showTerminalSession).toHaveBeenCalledWith(
      'term-111111111111111111111',
      expect.objectContaining({
        navigationGeneration: expect.any(Number),
        onCommit: expect.any(Function),
        onAbandon: expect.any(Function),
      }),
    )
  })

  test('new terminal action joins a pending duplicate create through terminal ownership', async () => {
    const branchName = terminalPresentationBranch(terminalBase.presentation)
    if (!branchName) throw new Error('expected Git worktree terminal fixture')
    seedRepoWithReadModelForTest({
      id: terminalCoordinates.workspaceId,
      workspaceRuntimeId: terminalCoordinates.workspaceRuntimeId,
      branches: [
        createRepoBranch(branchName, {
          worktree: { path: terminalExecutionPath(terminalBase.target), isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: branchName,
    })
    const createTerminal = vi.fn(async () => 'created-session')
    const createTerminalWithAdmission = vi.fn(async () => ({
      terminalSessionId: 'created-session',
      presentation: terminalBase.presentation,
      requestRole: 'observer' as const,
      resourceDisposition: 'created' as const,
      runtimeProjectionApplied: true,
    }))
    const showTerminalSession = vi.fn(() => true)
    const showCreatedTerminalSession = vi.fn(
      (_terminalSessionId: string, _presentation: unknown, _routeRequest: CreatedTerminalRouteRequest) => true,
    )
    const focusTerminal = vi.fn((_terminalSessionId: string, _request?: TerminalFocusRequest) => true)
    const bridge: TerminalSessionCommandBridge = {
      terminalFilesystemTargetSnapshot: () => ({
        terminalFilesystemTargetKey: '/repo\0/repo-worktree',
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
      focusTerminal,
    }

    await expect(
      runWorkspacePaneRuntimeNewAction('terminal', {
        terminal: {
          routeTarget: terminalRouteTarget,
          base: terminalBase,
          bridge,
          openerIdentity: null,
          showTerminalSession,
          showCreatedTerminalSession,
        },
      }),
    ).resolves.toBe(true)

    expect(showTerminalSession).not.toHaveBeenCalled()
    expect(showCreatedTerminalSession).toHaveBeenCalledOnce()
    expect(createTerminalWithAdmission).toHaveBeenCalledWith(terminalBase, undefined)
    expect(createTerminal).not.toHaveBeenCalled()
    expect(focusTerminal).toHaveBeenCalledWith(
      'created-session',
      expect.objectContaining({ isCurrent: expect.any(Function), onSettled: expect.any(Function) }),
    )
    const focusRequest = focusTerminal.mock.calls[0]![1]
    if (!focusRequest) throw new Error('missing focus request')
    expect(focusRequest.isCurrent()).toBe(true)
    focusRequest.onSettled?.()
  })

  test('primary terminal action rejects when no bridge is available', async () => {
    const showTerminalSession = vi.fn(() => true)

    await expect(
      runWorkspacePaneRuntimePrimaryAction('terminal', {
        terminal: {
          routeTarget: terminalRouteTarget,
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
          routeTarget: terminalRouteTarget,
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
    terminalFilesystemTargetKey: '/repo\0/repo-worktree',
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

function createdTerminalRouteRequest(): CreatedTerminalRouteRequest {
  return { navigationGeneration: beginAppNavigation(), routeTarget: terminalRouteTarget }
}
