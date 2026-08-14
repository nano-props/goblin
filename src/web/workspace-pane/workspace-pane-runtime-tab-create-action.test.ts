import {
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  createRepoBranch,
  createRepoWorktreeSnapshotForTest,
} from '#/web/test-utils/repo-store.ts'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { TerminalCreateLeaderAdmissionResult } from '#/web/terminal/components/terminal-create-admission.ts'
import type { TerminalFocusRequest } from '#/web/terminal/components/types.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  commitCreatedTerminalWorkspacePaneRuntimeTab,
  dispatchCreateTerminalWorkspacePaneRuntimeTabAction,
  showCreatedTerminalWorkspacePaneRuntimeTab,
  type CreatedTerminalRouteRequest,
  type WorkspacePaneRuntimeTabCreateStateByType,
  workspacePaneRuntimeTabCreateAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import { workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { workspacePaneTabsTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import { appQueryClient } from '#/web/app/query-client.ts'
import { workspacePaneTabsQueryKey } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import {
  beginAppNavigation,
  appNavigationIsCurrent,
  resetAppNavigationForTest,
} from '#/web/app/navigation/lifecycle.ts'
import { resetTerminalAutoFocusForTest } from '#/web/terminal/focus.ts'
import {
  resetWorkspacePaneActionQueueForTest,
  runWorkspacePaneAction,
  workspacePaneActionTargetFromFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import type {
  TerminalCreateCommandResult,
  TerminalCreatedTabCommitResult,
} from '#/web/commands/terminal-create-command.ts'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'

const REPO_ROOT = 'goblin+file:///tmp/workspace-pane-runtime-create-repo'
const WORKSPACE_RUNTIME_ID = 'repo-runtime-workspace-pane-create'
const BRANCH_NAME = 'main'
const WORKTREE_PATH = '/tmp/workspace-pane-runtime-create-worktree'
const TERMINAL_SESSION_ID = 'term-111111111111111111111'
const BASE: TerminalSessionBase = {
  target: {
    kind: 'git-worktree' as const,
    workspaceId: canonicalWorkspaceLocator(REPO_ROOT)!,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    root: canonicalWorkspaceLocator('goblin+file:///tmp/workspace-pane-runtime-create-worktree')!,
  },
  presentation: { kind: 'git-worktree' as const },
}
const PANE_TARGET = workspacePaneTabsTargetFromRuntime(BASE.target)!
const WORKTREE_ROUTE_TARGET = {
  kind: 'git-worktree' as const,
  workspaceId: BASE.target.workspaceId,
  worktreePath: WORKTREE_PATH,
}

const terminalCreateCommandMocks = vi.hoisted(() => ({
  runCreateTerminalTabCommand: vi.fn(),
}))
const terminalCreateFeedbackMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('#/web/commands/terminal-create-command.ts', () => ({
  runCreateTerminalTabCommand: terminalCreateCommandMocks.runCreateTerminalTabCommand,
}))
vi.mock('vue-sonner', () => ({ toast: terminalCreateFeedbackMocks }))

beforeEach(() => {
  appQueryClient.clear()
  terminalProjectionHydrationStore.setState({
    hydrationByWorkspace: new Map(),
    lastSuccessfulRecoveryByWorkspace: new Map(),
  })
  resetWorkspacePaneActionQueueForTest()
  resetTerminalAutoFocusForTest()
  resetAppNavigationForTest()
  resetWorkspacesStore()
  seedCurrentWorkspaceRuntime(WORKSPACE_RUNTIME_ID)
  setWorkspacePaneTabsForTargetQueryData({
    ...PANE_TARGET,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    tabs: [],
  })
  terminalCreateCommandMocks.runCreateTerminalTabCommand.mockReset()
  terminalCreateFeedbackMocks.error.mockReset()
  terminalCreateFeedbackMocks.warning.mockReset()
  terminalCreateCommandMocks.runCreateTerminalTabCommand.mockResolvedValue({
    ok: true,
    terminalSessionId: TERMINAL_SESSION_ID,
    presentationStatus: 'committed',
  })
})

afterEach(() => {
  terminalProjectionHydrationStore.setState({
    hydrationByWorkspace: new Map(),
    lastSuccessfulRecoveryByWorkspace: new Map(),
  })
  resetWorkspacePaneActionQueueForTest()
  resetTerminalAutoFocusForTest()
  resetWorkspacesStore()
  document.body.replaceChildren()
})

describe('workspace pane runtime tab create action', () => {
  test.each(['pending', 'failed'] as const)(
    'fails closed when canonical workspace tabs are %s',
    async (projectionPhase) => {
      appQueryClient.removeQueries({
        queryKey: workspacePaneTabsQueryKey(BASE.target.workspaceId, WORKSPACE_RUNTIME_ID),
      })
      if (projectionPhase === 'failed') {
        await expect(
          appQueryClient.fetchQuery({
            queryKey: workspacePaneTabsQueryKey(BASE.target.workspaceId, WORKSPACE_RUNTIME_ID),
            queryFn: async () => {
              throw new Error('workspace tabs unavailable')
            },
            retry: false,
          }),
        ).rejects.toThrow('workspace tabs unavailable')
      }

      await expect(
        dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
          base: BASE,
          createTerminal: vi.fn(),
          openerIdentity: null,
          showCreatedTerminalTab: vi.fn(),
          focusTerminal: vi.fn(),
          t: translate,
        }),
      ).resolves.toMatchObject({
        ok: false,
        messageKey:
          projectionPhase === 'failed'
            ? 'error.terminal-create-blocked-load-failed'
            : 'error.terminal-create-blocked-loading',
      })

      expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).not.toHaveBeenCalled()
      expect(terminalCreateFeedbackMocks.error).toHaveBeenCalledWith('action.result-error', {
        description:
          projectionPhase === 'failed'
            ? 'error.terminal-create-blocked-load-failed'
            : 'error.terminal-create-blocked-loading',
      })
    },
  )

  test('fails fast when settled workspace tabs and terminals disagree', async () => {
    setWorkspacePaneTabsForTargetQueryData({
      ...PANE_TARGET,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      tabs: [workspacePaneRuntimeTabEntry('terminal', TERMINAL_SESSION_ID)],
    })
    terminalProjectionHydrationStore
      .getState()
      .markProjectionReady(BASE.target.workspaceId, WORKSPACE_RUNTIME_ID)

    await expect(
      dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
        base: BASE,
        createTerminal: vi.fn(),
        openerIdentity: null,
        showCreatedTerminalTab: vi.fn(),
        focusTerminal: vi.fn(),
        t: translate,
      }),
    ).resolves.toMatchObject({
      ok: false,
      messageKey: 'error.workspace-pane-state-inconsistent',
    })

    expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).not.toHaveBeenCalled()
    expect(terminalCreateFeedbackMocks.error).toHaveBeenCalledWith('action.result-error', {
      description: 'error.workspace-pane-state-inconsistent',
    })
  })

  test('rechecks canonical materialization after waiting in the target queue', async () => {
    const queuedActionMayRun = Promise.withResolvers<void>()
    const coordinatorTarget = workspacePaneActionTargetFromFilesystemTarget(BASE.target)
    const blocker = runWorkspacePaneAction(coordinatorTarget, async () => {
      await queuedActionMayRun.promise
      return true
    })
    const dispatch = dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
      base: BASE,
      createTerminal: vi.fn(),
      openerIdentity: null,
      showCreatedTerminalTab: vi.fn(),
      focusTerminal: vi.fn(),
    })
    setWorkspacePaneTabsForTargetQueryData({
      ...PANE_TARGET,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      tabs: [workspacePaneRuntimeTabEntry('terminal', TERMINAL_SESSION_ID)],
    })

    queuedActionMayRun.resolve()
    await blocker
    await expect(dispatch).resolves.toMatchObject({ ok: false })
    expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).not.toHaveBeenCalled()
  })

  test('fails closed when a canonical terminal trails an otherwise ready runtime projection', async () => {
    terminalProjectionHydrationStore.getState().markProjectionReady(BASE.target.workspaceId, WORKSPACE_RUNTIME_ID)
    setWorkspacePaneTabsForTargetQueryData({
      ...PANE_TARGET,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      tabs: [workspacePaneRuntimeTabEntry('terminal', TERMINAL_SESSION_ID)],
    })

    await expect(
      dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
        base: BASE,
        createTerminal: vi.fn(),
        openerIdentity: null,
        showCreatedTerminalTab: vi.fn(),
        focusTerminal: vi.fn(),
      }),
    ).resolves.toMatchObject({ ok: false })
    expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).not.toHaveBeenCalled()
  })

  test('navigates a detached worktree create to its real filesystem surface', async () => {
    const commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)
    const routeRequest = createdTerminalRouteRequest()
    const detachedBase: TerminalSessionBase = {
      ...BASE,
      presentation: { kind: 'git-worktree' },
    }

    await expect(
      showCreatedTerminalWorkspacePaneRuntimeTab(
        detachedBase,
        TERMINAL_SESSION_ID,
        {
          commitFilesystemWorkspacePaneRoute,
          commitWorkspaceRootTerminalSession: vi.fn(async () => {
            throw new Error('Unexpected workspace-root commit in detached-worktree test')
          }),
        },
        routeRequest,
      ),
    ).resolves.toBe(true)
    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      {
        routeTarget: WORKTREE_ROUTE_TARGET,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      },
      { kind: 'terminal', terminalSessionId: TERMINAL_SESSION_ID },
      routeRequest,
    )
  })

  test('commits a workspace root terminal route through navigation authority', async () => {
    const commitWorkspaceRootTerminalSession = vi.fn(async () => true)
    const routeRequest = createdTerminalRouteRequest()
    const workspaceRootBase: TerminalSessionBase = {
      target: {
        kind: 'workspace-root',
        workspaceId: BASE.target.workspaceId,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      },
      presentation: { kind: 'workspace-root' },
    }

    await expect(
      showCreatedTerminalWorkspacePaneRuntimeTab(
        workspaceRootBase,
        TERMINAL_SESSION_ID,
        {
          commitFilesystemWorkspacePaneRoute: vi.fn(async () => {
            throw new Error('Unexpected worktree commit in workspace-root test')
          }),
          commitWorkspaceRootTerminalSession,
        },
        routeRequest,
      ),
    ).resolves.toBe(true)
    expect(commitWorkspaceRootTerminalSession).toHaveBeenCalledWith(
      REPO_ROOT,
      WORKSPACE_RUNTIME_ID,
      TERMINAL_SESSION_ID,
      routeRequest,
    )
  })

  test('returns no terminal create action without a runtime target', () => {
    const action = workspacePaneRuntimeTabCreateAction('terminal', {
      runtimeTabStateByType: runtimeTabState(),
      showCreatedRuntimeTab: vi.fn(),
      t: translate,
      terminal: {
        base: null,
        createTerminal: vi.fn(async () => createAdmission()),
        captureOpenerIdentity: vi.fn(() => null),
        focusTerminal: vi.fn(),
      },
    })

    expect(action).toBeNull()
  })

  test('captures the opener at the user boundary and delegates to the application command', async () => {
    const createTerminal = vi.fn(async () => createAdmission())
    const showCreatedRuntimeTab = vi.fn(() => true)
    const captureOpenerIdentity = vi.fn(() => 'workspace-pane:status')
    const action = workspacePaneRuntimeTabCreateAction('terminal', {
      runtimeTabStateByType: runtimeTabState(),
      showCreatedRuntimeTab,
      t: translate,
      terminal: {
        base: BASE,
        createTerminal,
        captureOpenerIdentity,
        focusTerminal: vi.fn(),
      },
    })

    action?.onCreate()
    await vi.waitFor(() => expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).toHaveBeenCalledOnce())

    expect(captureOpenerIdentity).toHaveBeenCalledOnce()
    expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        base: BASE,
        createTerminal,
        t: translate,
        commitCreatedTerminalTab: expect.any(Function),
      }),
    )
    const commandInput = terminalCreateCommandMocks.runCreateTerminalTabCommand.mock.calls[0]?.[0] as {
      commitCreatedTerminalTab: (admission: TerminalCreateLeaderAdmissionResult) => Promise<unknown>
    }
    await commandInput.commitCreatedTerminalTab(createAdmission())
    expect(showCreatedRuntimeTab).toHaveBeenCalledWith(
      'terminal',
      TERMINAL_SESSION_ID,
      {
        kind: 'git-worktree' as const,
      },
      expect.objectContaining({
        navigationGeneration: expect.any(Number),
      }),
    )
  })

  test('captures presentation authority when create begins and does not revive it after later navigation', async () => {
    const showCreatedRuntimeTab = vi.fn((_type, _sessionId, _presentation, routeRequest) =>
      appNavigationIsCurrent(routeRequest.navigationGeneration),
    )
    const action = workspacePaneRuntimeTabCreateAction('terminal', {
      runtimeTabStateByType: runtimeTabState(),
      showCreatedRuntimeTab,
      t: translate,
      terminal: {
        base: BASE,
        createTerminal: vi.fn(async () => createAdmission()),
        captureOpenerIdentity: vi.fn(() => null),
        focusTerminal: vi.fn(),
      },
    })

    action?.onCreate()
    await vi.waitFor(() => expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).toHaveBeenCalledOnce())
    beginAppNavigation()
    const commandInput = terminalCreateCommandMocks.runCreateTerminalTabCommand.mock.calls[0]?.[0] as {
      commitCreatedTerminalTab: (admission: TerminalCreateLeaderAdmissionResult) => Promise<unknown>
    }

    await expect(commandInput.commitCreatedTerminalTab(createAdmission())).resolves.toEqual({
      status: 'navigation-rejected',
    })
    expect(showCreatedRuntimeTab).toHaveReturnedWith(false)
  })

  test('claims one presentation when the queued dispatch begins and transfers focus only after route commit', async () => {
    const createButton = document.createElement('button')
    document.body.appendChild(createButton)
    createButton.focus()
    const previousPresentation = beginAppNavigation()
    const heldCommand = holdTerminalCreateCommand()
    const navigation = Promise.withResolvers<boolean>()
    const routeStarted = Promise.withResolvers<CreatedTerminalRouteRequest>()
    const focusTerminal = vi.fn((_terminalSessionId: string, _request?: TerminalFocusRequest) => true)

    const dispatch = dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
      base: BASE,
      createTerminal: vi.fn(async () => createAdmission()),
      openerIdentity: null,
      showCreatedTerminalTab: async (_terminalSessionId, _presentation, routeRequest) => {
        routeStarted.resolve(routeRequest)
        return await navigation.promise
      },
      focusTerminal,
    })

    expect(appNavigationIsCurrent(previousPresentation)).toBe(false)
    expect(document.activeElement).toBe(createButton)
    const commandInput = await heldCommand.input.promise
    const commit = commandInput.commitCreatedTerminalTab(createAdmission())
    const routeRequest = await routeStarted.promise

    expect(appNavigationIsCurrent(routeRequest.navigationGeneration)).toBe(true)
    expect(focusTerminal).not.toHaveBeenCalled()
    navigation.resolve(true)
    await expect(commit).resolves.toEqual({ status: 'committed' })
    expect(focusTerminal).toHaveBeenCalledWith(
      TERMINAL_SESSION_ID,
      expect.objectContaining({ isCurrent: expect.any(Function), onSettled: expect.any(Function) }),
    )
    const focusRequest = focusTerminal.mock.calls[0]![1]
    if (!focusRequest) throw new Error('missing focus request')
    expect(focusRequest.isCurrent()).toBe(true)

    heldCommand.result.resolve(committedCreateCommandResult())
    await expect(dispatch).resolves.toEqual(committedCreateCommandResult())

    focusRequest.onSettled?.()
  })

  test('releases automatic focus when terminal creation fails', async () => {
    terminalCreateCommandMocks.runCreateTerminalTabCommand.mockResolvedValueOnce({
      ok: false,
      error: new Error('create failed'),
      messageKey: 'error.terminal-create-failed',
    })
    const focusTerminal = vi.fn()

    const dispatch = dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
      base: BASE,
      createTerminal: vi.fn(async () => createAdmission()),
      openerIdentity: null,
      showCreatedTerminalTab: vi.fn(() => true),
      focusTerminal,
    })

    await expect(dispatch).resolves.toMatchObject({ ok: false })
    expect(focusTerminal).not.toHaveBeenCalled()
  })

  test('serializes presentation authority for concurrent creates on the same target', async () => {
    const terminalSessionIds = [
      'term-111111111111111111111',
      'term-222222222222222222222',
      'term-333333333333333333333',
    ]
    const createCommandsMayCommit = Promise.withResolvers<void>()
    let commandIndex = 0
    terminalCreateCommandMocks.runCreateTerminalTabCommand.mockImplementation(async (commandInput) => {
      const terminalSessionId = terminalSessionIds[commandIndex]
      commandIndex += 1
      if (!terminalSessionId) throw new Error('unexpected terminal create command')
      await createCommandsMayCommit.promise
      const commit = await commandInput.commitCreatedTerminalTab(createAdmission(terminalSessionId))
      return {
        ok: true,
        terminalSessionId,
        presentationStatus: commit.status,
      }
    })
    const presentedTerminalSessionIds: string[] = []
    const showCreatedTerminalTab = vi.fn(
      async (terminalSessionId: string, _presentation: unknown, routeRequest: CreatedTerminalRouteRequest) => {
        expect(appNavigationIsCurrent(routeRequest.navigationGeneration)).toBe(true)
        expect(routeRequest.routePrecondition).toEqual({ kind: 'current-workspace-target' })
        presentedTerminalSessionIds.push(terminalSessionId)
        return true
      },
    )
    const dispatches = terminalSessionIds.map(() =>
      dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
        base: BASE,
        createTerminal: vi.fn(async () => createAdmission()),
        openerIdentity: null,
        showCreatedTerminalTab,
        focusTerminal: vi.fn(),
      }),
    )
    createCommandsMayCommit.resolve()

    await expect(Promise.all(dispatches)).resolves.toEqual(
      terminalSessionIds.map((terminalSessionId) => ({
        ok: true,
        terminalSessionId,
        presentationStatus: 'committed',
      })),
    )
    expect(presentedTerminalSessionIds).toEqual(terminalSessionIds)
  })

  test('continues queued creates but rejects presentation after the router leaves the target', async () => {
    const terminalSessionIds = ['term-111111111111111111111', 'term-222222222222222222222']
    const firstCommandMayPresent = Promise.withResolvers<void>()
    const firstAdmissionReady = Promise.withResolvers<void>()
    let commandIndex = 0
    terminalCreateCommandMocks.runCreateTerminalTabCommand.mockImplementation(async (commandInput) => {
      const terminalSessionId = terminalSessionIds[commandIndex]
      commandIndex += 1
      if (!terminalSessionId) throw new Error('unexpected terminal create command')
      const admission = createAdmission(terminalSessionId)
      if (terminalSessionId === terminalSessionIds[0]) {
        firstAdmissionReady.resolve()
        await firstCommandMayPresent.promise
      }
      const commit = await commandInput.commitCreatedTerminalTab(admission)
      return {
        ok: true,
        terminalSessionId,
        presentationStatus: commit.status,
      }
    })
    let routerPresentsTarget = true
    const presentationAttempts: string[] = []
    const showCreatedTerminalTab = vi.fn(
      async (terminalSessionId: string, _presentation: unknown, routeRequest: CreatedTerminalRouteRequest) => {
        expect(routeRequest.routePrecondition).toEqual({ kind: 'current-workspace-target' })
        presentationAttempts.push(terminalSessionId)
        return routerPresentsTarget
      },
    )
    const dispatches = terminalSessionIds.map(() =>
      dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
        base: BASE,
        createTerminal: vi.fn(async () => createAdmission()),
        openerIdentity: null,
        showCreatedTerminalTab,
        focusTerminal: vi.fn(),
      }),
    )

    await firstAdmissionReady.promise
    routerPresentsTarget = false
    firstCommandMayPresent.resolve()

    await expect(Promise.all(dispatches)).resolves.toEqual(
      terminalSessionIds.map((terminalSessionId) => ({
        ok: true,
        terminalSessionId,
        presentationStatus: 'navigation-rejected',
      })),
    )
    expect(presentationAttempts).toEqual(terminalSessionIds)
  })

  test('releases automatic focus when the create target is superseded', async () => {
    const heldCommand = holdTerminalCreateCommand()
    const showCreatedTerminalTab = vi.fn(() => true)
    const focusTerminal = vi.fn()
    const dispatch = dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
      base: BASE,
      createTerminal: vi.fn(async () => createAdmission()),
      openerIdentity: null,
      showCreatedTerminalTab,
      focusTerminal,
    })
    const commandInput = await heldCommand.input.promise

    seedCurrentWorkspaceRuntime('repo-runtime-replacement')
    await expect(commandInput.commitCreatedTerminalTab(createAdmission())).resolves.toEqual({ status: 'superseded' })
    heldCommand.result.resolve({
      ok: true,
      terminalSessionId: TERMINAL_SESSION_ID,
      presentationStatus: 'superseded',
    })
    await dispatch

    expect(showCreatedTerminalTab).not.toHaveBeenCalled()
    expect(focusTerminal).not.toHaveBeenCalled()
  })

  test('does not create after a queued target runtime is replaced', async () => {
    const blocker = Promise.withResolvers<void>()
    const blockingAction = runWorkspacePaneAction(
      workspacePaneActionTargetFromFilesystemTarget(BASE.target),
      () => blocker.promise,
    )
    const createTerminal = vi.fn(async () => createAdmission())
    const dispatch = dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
      base: BASE,
      createTerminal,
      openerIdentity: null,
      showCreatedTerminalTab: vi.fn(() => true),
      focusTerminal: vi.fn(),
    })

    seedCurrentWorkspaceRuntime('repo-runtime-replacement')
    blocker.resolve()
    await blockingAction

    await expect(dispatch).resolves.toMatchObject({ ok: false, messageKey: 'error.terminal-create-failed' })
    expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).not.toHaveBeenCalled()
    expect(createTerminal).not.toHaveBeenCalled()
  })

  test('releases automatic focus when navigation rejects the created route', async () => {
    const heldCommand = holdTerminalCreateCommand()
    const focusTerminal = vi.fn()
    const dispatch = dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
      base: BASE,
      createTerminal: vi.fn(async () => createAdmission()),
      openerIdentity: null,
      showCreatedTerminalTab: vi.fn(() => false),
      focusTerminal,
    })
    const commandInput = await heldCommand.input.promise

    await expect(commandInput.commitCreatedTerminalTab(createAdmission())).resolves.toEqual({
      status: 'navigation-rejected',
    })
    heldCommand.result.resolve({
      ok: true,
      terminalSessionId: TERMINAL_SESSION_ID,
      presentationStatus: 'navigation-rejected',
    })
    await dispatch
    expect(focusTerminal).not.toHaveBeenCalled()
  })

  test('does not focus when an older create commits after a newer presentation', async () => {
    const heldCommand = holdTerminalCreateCommand()
    const focusTerminal = vi.fn()
    const dispatch = dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
      base: BASE,
      createTerminal: vi.fn(async () => createAdmission()),
      openerIdentity: null,
      showCreatedTerminalTab: vi.fn(() => true),
      focusTerminal,
    })
    const commandInput = await heldCommand.input.promise

    beginAppNavigation()
    await expect(commandInput.commitCreatedTerminalTab(createAdmission())).resolves.toEqual({ status: 'committed' })
    heldCommand.result.resolve(committedCreateCommandResult())
    await dispatch

    expect(focusTerminal).not.toHaveBeenCalled()
  })

  test('delegates creation with the exact base and route commit boundary', async () => {
    await expect(
      dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
        base: BASE,
        createTerminal: vi.fn(async () => createAdmission()),
        openerIdentity: null,
        showCreatedTerminalTab: vi.fn(() => true),
        focusTerminal: vi.fn(),
        t: translate,
      }),
    ).resolves.toEqual({ ok: true, terminalSessionId: TERMINAL_SESSION_ID, presentationStatus: 'committed' })

    expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).toHaveBeenCalledWith(
      expect.objectContaining({ base: BASE, commitCreatedTerminalTab: expect.any(Function) }),
    )
  })

  test('records the opener and commits the exact route without another projection request', async () => {
    const admission = createAdmission()
    const showCreatedTerminalTab = vi.fn(() => {
      expect(workspacePaneTabOpener(PANE_TARGET, WORKSPACE_RUNTIME_ID, `terminal:${TERMINAL_SESSION_ID}`)).toBe(
        'workspace-pane:status',
      )
      return true
    })

    await expect(
      commitCreatedTerminalWorkspacePaneRuntimeTab({
        base: BASE,
        admission,
        openerIdentity: 'workspace-pane:status',
        showCreatedTerminalTab,
      }),
    ).resolves.toEqual({ status: 'committed' })

    expect(showCreatedTerminalTab).toHaveBeenCalledWith(TERMINAL_SESSION_ID, {
      kind: 'git-worktree' as const,
    })
  })

  test('presents a coalesced create observer without claiming opener ownership', async () => {
    const showCreatedTerminalTab = vi.fn(() => true)

    await expect(
      commitCreatedTerminalWorkspacePaneRuntimeTab({
        base: BASE,
        admission: { ...createAdmission(), requestRole: 'observer' },
        openerIdentity: 'workspace-pane:status',
        showCreatedTerminalTab,
      }),
    ).resolves.toEqual({ status: 'committed' })

    expect(showCreatedTerminalTab).toHaveBeenCalledWith(TERMINAL_SESSION_ID, BASE.presentation)
    expect(workspacePaneTabOpener(PANE_TARGET, WORKSPACE_RUNTIME_ID, `terminal:${TERMINAL_SESSION_ID}`)).toBeNull()
  })

  test('does not navigate or record opener after the command target runtime is superseded', async () => {
    seedCurrentWorkspaceRuntime('repo-runtime-replacement')
    const showCreatedTerminalTab = vi.fn(() => true)

    await expect(
      commitCreatedTerminalWorkspacePaneRuntimeTab({
        base: BASE,
        admission: createAdmission(),
        openerIdentity: 'workspace-pane:status',
        showCreatedTerminalTab,
      }),
    ).resolves.toEqual({ status: 'superseded' })

    expect(showCreatedTerminalTab).not.toHaveBeenCalled()
    expect(workspacePaneTabOpener(PANE_TARGET, WORKSPACE_RUNTIME_ID, `terminal:${TERMINAL_SESSION_ID}`)).toBeNull()
    expect(workspacesStore.getState().workspaces[REPO_ROOT]?.workspaceRuntimeId).toBe('repo-runtime-replacement')
  })

  test('does not navigate or record opener when a newer terminal projection supersedes the create response', async () => {
    const showCreatedTerminalTab = vi.fn(() => true)

    await expect(
      commitCreatedTerminalWorkspacePaneRuntimeTab({
        base: BASE,
        admission: { ...createAdmission(), runtimeProjectionApplied: false },
        openerIdentity: 'workspace-pane:status',
        showCreatedTerminalTab,
      }),
    ).resolves.toEqual({ status: 'superseded' })

    expect(showCreatedTerminalTab).not.toHaveBeenCalled()
    expect(workspacePaneTabOpener(PANE_TARGET, WORKSPACE_RUNTIME_ID, `terminal:${TERMINAL_SESSION_ID}`)).toBeNull()
  })

  test('rejects a server presentation that does not match the execution target', async () => {
    const showCreatedTerminalTab = vi.fn(() => true)

    await expect(
      commitCreatedTerminalWorkspacePaneRuntimeTab({
        base: BASE,
        admission: { ...createAdmission(), presentation: { kind: 'workspace-root' } },
        openerIdentity: 'workspace-pane:status',
        showCreatedTerminalTab,
      }),
    ).rejects.toThrow('terminal target and presentation disagree')

    expect(showCreatedTerminalTab).not.toHaveBeenCalled()
    expect(workspacePaneTabOpener(PANE_TARGET, WORKSPACE_RUNTIME_ID, `terminal:${TERMINAL_SESSION_ID}`)).toBeNull()
  })

  test('marks the terminal create action busy only while terminal creation is pending', () => {
    const pendingAction = workspacePaneRuntimeTabCreateAction('terminal', {
      runtimeTabStateByType: runtimeTabState({ createPending: true }),
      showCreatedRuntimeTab: vi.fn(),
      t: translate,
      terminal: {
        base: BASE,
        createTerminal: vi.fn(async () => createAdmission()),
        captureOpenerIdentity: vi.fn(() => null),
        focusTerminal: vi.fn(),
      },
    })
    expect(pendingAction?.busy).toBe(true)
    expect(pendingAction?.blocksTabInteraction).toBe(true)
    pendingAction?.onCreate()
    expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).not.toHaveBeenCalled()
  })
})

function translate(key: string): string {
  return key
}

function createdTerminalRouteRequest(): CreatedTerminalRouteRequest {
  return {
    navigationGeneration: beginAppNavigation(),
    routePrecondition: { kind: 'current-workspace-target' },
  }
}

interface HeldTerminalCreateCommandInput {
  commitCreatedTerminalTab: (
    admission: TerminalCreateLeaderAdmissionResult,
  ) => TerminalCreatedTabCommitResult | Promise<TerminalCreatedTabCommitResult>
}

function holdTerminalCreateCommand(): {
  input: PromiseWithResolvers<HeldTerminalCreateCommandInput>
  result: PromiseWithResolvers<TerminalCreateCommandResult>
} {
  const input = Promise.withResolvers<HeldTerminalCreateCommandInput>()
  const result = Promise.withResolvers<TerminalCreateCommandResult>()
  terminalCreateCommandMocks.runCreateTerminalTabCommand.mockImplementationOnce(async (commandInput) => {
    input.resolve(commandInput)
    return await result.promise
  })
  return { input, result }
}

function committedCreateCommandResult(): TerminalCreateCommandResult {
  return {
    ok: true,
    terminalSessionId: TERMINAL_SESSION_ID,
    presentationStatus: 'committed',
  }
}

function createAdmission(terminalSessionId = TERMINAL_SESSION_ID): TerminalCreateLeaderAdmissionResult {
  return {
    terminalSessionId,
    presentation: { kind: 'git-worktree' as const },
    requestRole: 'leader',
    resourceDisposition: 'created',
    runtimeProjectionApplied: true,
  }
}

function runtimeTabState(input: { createPending?: boolean } = {}): WorkspacePaneRuntimeTabCreateStateByType {
  return { terminal: { createPending: input.createPending ?? false } }
}

function seedCurrentWorkspaceRuntime(workspaceRuntimeId: string): void {
  seedRepoWithReadModelForTest({
    id: REPO_ROOT,
    workspaceRuntimeId,
    branches: [createRepoBranch(BRANCH_NAME)],
    worktrees: [createRepoWorktreeSnapshotForTest(BRANCH_NAME, WORKTREE_PATH)],
    currentBranchName: BRANCH_NAME,
  })
}
