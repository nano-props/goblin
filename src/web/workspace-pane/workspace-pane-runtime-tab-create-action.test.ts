import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { TerminalCreateLeaderAdmissionResult } from '#/web/components/terminal/terminal-create-admission.ts'
import type { TerminalFocusRequest } from '#/web/components/terminal/types.ts'
import { createRepoBranch, resetWorkspacesStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
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
import {
  beginPrimaryWindowNavigation,
  primaryWindowNavigationIsCurrent,
  resetPrimaryWindowNavigationForTest,
} from '#/web/primary-window-navigation-lifecycle.ts'
import { resetTerminalAutoFocusForTest } from '#/web/terminal-focus.ts'
import type {
  TerminalCreateCommandResult,
  TerminalCreatedTabCommitResult,
} from '#/web/commands/terminal-create-command.ts'

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
  presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH_NAME } },
}
const PANE_TARGET = workspacePaneTabsTargetFromRuntime(BASE.target)!
const BRANCH_ROUTE_TARGET = {
  kind: 'git-branch' as const,
  workspaceId: BASE.target.workspaceId,
  branchName: BRANCH_NAME,
}
const WORKTREE_ROUTE_TARGET = {
  kind: 'git-worktree' as const,
  workspaceId: BASE.target.workspaceId,
  worktreePath: WORKTREE_PATH,
}
const WORKSPACE_ROOT_ROUTE_TARGET = { kind: 'workspace-root' as const, workspaceId: BASE.target.workspaceId }

const terminalCreateCommandMocks = vi.hoisted(() => ({
  runCreateTerminalTabCommand: vi.fn(),
}))

vi.mock('#/web/commands/terminal-create-command.ts', () => ({
  runCreateTerminalTabCommand: terminalCreateCommandMocks.runCreateTerminalTabCommand,
}))

beforeEach(() => {
  resetTerminalAutoFocusForTest()
  resetPrimaryWindowNavigationForTest()
  resetWorkspacesStore()
  seedCurrentWorkspaceRuntime(WORKSPACE_RUNTIME_ID)
  terminalCreateCommandMocks.runCreateTerminalTabCommand.mockReset()
  terminalCreateCommandMocks.runCreateTerminalTabCommand.mockResolvedValue({
    ok: true,
    terminalSessionId: TERMINAL_SESSION_ID,
    presentationStatus: 'committed',
  })
})

afterEach(() => {
  resetTerminalAutoFocusForTest()
  resetWorkspacesStore()
  document.body.replaceChildren()
})

describe('workspace pane runtime tab create action', () => {
  test('navigates a detached worktree create to its real filesystem surface', async () => {
    const commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)
    const routeRequest = createdTerminalRouteRequest(WORKTREE_ROUTE_TARGET)
    const detachedBase: TerminalSessionBase = {
      ...BASE,
      presentation: { kind: 'git-worktree', head: { kind: 'detached' } },
    }

    await expect(
      showCreatedTerminalWorkspacePaneRuntimeTab(
        detachedBase,
        TERMINAL_SESSION_ID,
        {
          commitWorkspacePaneRoute: vi.fn(async () => {
            throw new Error('Unexpected branch route commit in detached-worktree test')
          }),
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
        authority: { kind: 'detached-worktree' },
      },
      { kind: 'terminal', terminalSessionId: TERMINAL_SESSION_ID },
      routeRequest,
    )
  })

  test('commits a workspace root terminal route through navigation authority', async () => {
    const commitWorkspaceRootTerminalSession = vi.fn(async () => true)
    const routeRequest = createdTerminalRouteRequest(WORKSPACE_ROOT_ROUTE_TARGET)
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
          commitWorkspacePaneRoute: vi.fn(async () => {
            throw new Error('Unexpected branch route commit in workspace-root test')
          }),
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
        routeTarget: BRANCH_ROUTE_TARGET,
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
        routeTarget: BRANCH_ROUTE_TARGET,
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
        head: { kind: 'branch', branchName: BRANCH_NAME },
      },
      expect.objectContaining({
        navigationGeneration: expect.any(Number),
      }),
    )
  })

  test('captures presentation authority before create and does not revive it after later navigation', async () => {
    const showCreatedRuntimeTab = vi.fn((_type, _sessionId, _presentation, routeRequest) =>
      primaryWindowNavigationIsCurrent(routeRequest.navigationGeneration),
    )
    const action = workspacePaneRuntimeTabCreateAction('terminal', {
      runtimeTabStateByType: runtimeTabState(),
      showCreatedRuntimeTab,
      t: translate,
      terminal: {
        routeTarget: BRANCH_ROUTE_TARGET,
        base: BASE,
        createTerminal: vi.fn(async () => createAdmission()),
        captureOpenerIdentity: vi.fn(() => null),
        focusTerminal: vi.fn(),
      },
    })

    action?.onCreate()
    await vi.waitFor(() => expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).toHaveBeenCalledOnce())
    beginPrimaryWindowNavigation()
    const commandInput = terminalCreateCommandMocks.runCreateTerminalTabCommand.mock.calls[0]?.[0] as {
      commitCreatedTerminalTab: (admission: TerminalCreateLeaderAdmissionResult) => Promise<unknown>
    }

    await expect(commandInput.commitCreatedTerminalTab(createAdmission())).resolves.toEqual({
      status: 'navigation-rejected',
    })
    expect(showCreatedRuntimeTab).toHaveReturnedWith(false)
  })

  test('claims one presentation before dispatch and transfers focus only after route commit', async () => {
    const createButton = document.createElement('button')
    document.body.appendChild(createButton)
    createButton.focus()
    const previousPresentation = beginPrimaryWindowNavigation()
    const heldCommand = holdTerminalCreateCommand()
    const navigation = Promise.withResolvers<boolean>()
    const routeStarted = Promise.withResolvers<CreatedTerminalRouteRequest>()
    const focusTerminal = vi.fn((_terminalSessionId: string, _request?: TerminalFocusRequest) => true)

    const dispatch = dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
      routeTarget: BRANCH_ROUTE_TARGET,
      base: BASE,
      createTerminal: vi.fn(async () => createAdmission()),
      openerIdentity: null,
      showCreatedTerminalTab: async (_terminalSessionId, _presentation, routeRequest) => {
        routeStarted.resolve(routeRequest)
        return await navigation.promise
      },
      focusTerminal,
    })

    expect(primaryWindowNavigationIsCurrent(previousPresentation)).toBe(false)
    expect(document.activeElement).toBe(createButton)
    const commandInput = await heldCommand.input.promise
    const commit = commandInput.commitCreatedTerminalTab(createAdmission())
    const routeRequest = await routeStarted.promise

    expect(primaryWindowNavigationIsCurrent(routeRequest.navigationGeneration)).toBe(true)
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
      routeTarget: BRANCH_ROUTE_TARGET,
      base: BASE,
      createTerminal: vi.fn(async () => createAdmission()),
      openerIdentity: null,
      showCreatedTerminalTab: vi.fn(() => true),
      focusTerminal,
    })

    await expect(dispatch).resolves.toMatchObject({ ok: false })
    expect(focusTerminal).not.toHaveBeenCalled()
  })

  test('releases automatic focus when the create target is superseded', async () => {
    const heldCommand = holdTerminalCreateCommand()
    const showCreatedTerminalTab = vi.fn(() => true)
    const focusTerminal = vi.fn()
    const dispatch = dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
      routeTarget: BRANCH_ROUTE_TARGET,
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

  test('releases automatic focus when navigation rejects the created route', async () => {
    const heldCommand = holdTerminalCreateCommand()
    const focusTerminal = vi.fn()
    const dispatch = dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
      routeTarget: BRANCH_ROUTE_TARGET,
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
      routeTarget: BRANCH_ROUTE_TARGET,
      base: BASE,
      createTerminal: vi.fn(async () => createAdmission()),
      openerIdentity: null,
      showCreatedTerminalTab: vi.fn(() => true),
      focusTerminal,
    })
    const commandInput = await heldCommand.input.promise

    beginPrimaryWindowNavigation()
    await expect(commandInput.commitCreatedTerminalTab(createAdmission())).resolves.toEqual({ status: 'committed' })
    heldCommand.result.resolve(committedCreateCommandResult())
    await dispatch

    expect(focusTerminal).not.toHaveBeenCalled()
  })

  test('delegates creation with the exact base and route commit boundary', async () => {
    await expect(
      dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
        routeTarget: BRANCH_ROUTE_TARGET,
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
      head: { kind: 'branch', branchName: BRANCH_NAME },
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
    expect(useWorkspacesStore.getState().workspaces[REPO_ROOT]?.workspaceRuntimeId).toBe('repo-runtime-replacement')
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
        routeTarget: BRANCH_ROUTE_TARGET,
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

function createdTerminalRouteRequest(
  routeTarget: CreatedTerminalRouteRequest['routeTarget'] = BRANCH_ROUTE_TARGET,
): CreatedTerminalRouteRequest {
  return { navigationGeneration: beginPrimaryWindowNavigation(), routeTarget }
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

function createAdmission(): TerminalCreateLeaderAdmissionResult {
  return {
    terminalSessionId: TERMINAL_SESSION_ID,
    presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH_NAME } },
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
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: BRANCH_NAME,
  })
}
