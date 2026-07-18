import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { TerminalCreateLeaderAdmissionResult } from '#/web/components/terminal/terminal-create-admission.ts'
import { createRepoBranch, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  commitCreatedTerminalWorkspacePaneRuntimeTab,
  dispatchCreateTerminalWorkspacePaneRuntimeTabAction,
  type WorkspacePaneRuntimeTabCreateStateByType,
  workspacePaneRuntimeTabCreateAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import { workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const REPO_ROOT = 'goblin+file:///tmp/workspace-pane-runtime-create-repo'
const REPO_RUNTIME_ID = 'repo-runtime-workspace-pane-create'
const BRANCH_NAME = 'main'
const WORKTREE_PATH = '/tmp/workspace-pane-runtime-create-worktree'
const TERMINAL_SESSION_ID = 'term-111111111111111111111'
const BASE: TerminalSessionBase = {
  target: {
    kind: 'git-worktree',
    workspaceId: canonicalWorkspaceLocator(REPO_ROOT)!,
    workspaceRuntimeId: REPO_RUNTIME_ID,
    root: canonicalWorkspaceLocator('goblin+file:///tmp/workspace-pane-runtime-create-worktree')!,
  },
  presentation: { kind: 'git-worktree', branchName: BRANCH_NAME },
}

const terminalCreateCommandMocks = vi.hoisted(() => ({
  runCreateTerminalTabCommand: vi.fn(),
}))

vi.mock('#/web/commands/terminal-create-command.ts', () => ({
  runCreateTerminalTabCommand: terminalCreateCommandMocks.runCreateTerminalTabCommand,
}))

beforeEach(() => {
  resetReposStore()
  seedCurrentRepoRuntime(REPO_RUNTIME_ID)
  terminalCreateCommandMocks.runCreateTerminalTabCommand.mockReset()
  terminalCreateCommandMocks.runCreateTerminalTabCommand.mockResolvedValue({
    ok: true,
    terminalSessionId: TERMINAL_SESSION_ID,
    presentationStatus: 'committed',
  })
})

afterEach(() => {
  resetReposStore()
})

describe('workspace pane runtime tab create action', () => {
  test('returns no terminal create action without a runtime target', () => {
    const action = workspacePaneRuntimeTabCreateAction('terminal', {
      runtimeTabStateByType: runtimeTabState(),
      showCreatedRuntimeTab: vi.fn(),
      t: translate,
      terminal: {
        base: null,
        createTerminal: vi.fn(async () => createAdmission()),
        captureOpenerIdentity: vi.fn(() => null),
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
      terminal: { base: BASE, createTerminal, captureOpenerIdentity },
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
    expect(showCreatedRuntimeTab).toHaveBeenCalledWith('terminal', TERMINAL_SESSION_ID, {
      kind: 'git-worktree',
      branchName: BRANCH_NAME,
    })
  })

  test('dispatches immediately without holding the client workspace-pane operation queue', async () => {
    await expect(
      dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
        base: BASE,
        createTerminal: vi.fn(async () => createAdmission()),
        openerIdentity: null,
        showCreatedTerminalTab: vi.fn(() => true),
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
      expect(workspacePaneTabOpener(REPO_ROOT, REPO_RUNTIME_ID, BRANCH_NAME, `terminal:${TERMINAL_SESSION_ID}`)).toBe(
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
      kind: 'git-worktree',
      branchName: BRANCH_NAME,
    })
  })

  test('does not navigate or record opener after the command target runtime is superseded', async () => {
    seedCurrentRepoRuntime('repo-runtime-replacement')
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
    expect(
      workspacePaneTabOpener(REPO_ROOT, REPO_RUNTIME_ID, BRANCH_NAME, `terminal:${TERMINAL_SESSION_ID}`),
    ).toBeNull()
    expect(useReposStore.getState().repos[REPO_ROOT]?.repoRuntimeId).toBe('repo-runtime-replacement')
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

function createAdmission(): TerminalCreateLeaderAdmissionResult {
  return {
    terminalSessionId: TERMINAL_SESSION_ID,
    presentation: { kind: 'git-worktree', branchName: BRANCH_NAME },
    requestRole: 'leader',
    resourceDisposition: 'created',
    runtimeProjectionApplied: true,
  }
}

function runtimeTabState(input: { createPending?: boolean } = {}): WorkspacePaneRuntimeTabCreateStateByType {
  return { terminal: { createPending: input.createPending ?? false } }
}

function seedCurrentRepoRuntime(repoRuntimeId: string): void {
  seedRepoWithReadModelForTest({
    id: REPO_ROOT,
    repoRuntimeId,
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: BRANCH_NAME,
  })
}
