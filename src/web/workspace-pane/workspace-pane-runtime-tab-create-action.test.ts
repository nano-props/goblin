import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
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

const REPO_ROOT = '/tmp/workspace-pane-runtime-create-repo'
const REPO_RUNTIME_ID = 'repo-runtime-workspace-pane-create'
const BRANCH_NAME = 'main'
const WORKTREE_PATH = '/tmp/workspace-pane-runtime-create-worktree'
const TERMINAL_SESSION_ID = 'term-111111111111111111111'
const BASE: TerminalSessionBase = {
  repoRoot: REPO_ROOT,
  repoRuntimeId: REPO_RUNTIME_ID,
  branch: BRANCH_NAME,
  worktreePath: WORKTREE_PATH,
}

const terminalCreateCommandMocks = vi.hoisted(() => ({
  runCreateTerminalTabCommand: vi.fn(),
}))
const workspacePaneTabsCommitMocks = vi.hoisted(() => ({
  writeCanonicalWorkspacePaneTabsSnapshot: vi.fn(),
}))
const workspacePaneTabsQueryMocks = vi.hoisted(() => ({
  refreshWorkspacePaneTabs: vi.fn(),
}))

vi.mock('#/web/commands/terminal-create-command.ts', () => ({
  runCreateTerminalTabCommand: terminalCreateCommandMocks.runCreateTerminalTabCommand,
}))

vi.mock('#/web/workspace-pane/workspace-pane-tabs-commit.ts', () => ({
  writeCanonicalWorkspacePaneTabsSnapshot: workspacePaneTabsCommitMocks.writeCanonicalWorkspacePaneTabsSnapshot,
}))

vi.mock('#/web/workspace-pane/workspace-pane-tabs-query.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/web/workspace-pane/workspace-pane-tabs-query.ts')>()),
  refreshWorkspacePaneTabs: workspacePaneTabsQueryMocks.refreshWorkspacePaneTabs,
}))

beforeEach(() => {
  resetReposStore()
  seedCurrentRepoRuntime(REPO_RUNTIME_ID)
  terminalCreateCommandMocks.runCreateTerminalTabCommand.mockReset()
  terminalCreateCommandMocks.runCreateTerminalTabCommand.mockResolvedValue({
    ok: true,
    terminalSessionId: TERMINAL_SESSION_ID,
  })
  workspacePaneTabsCommitMocks.writeCanonicalWorkspacePaneTabsSnapshot.mockReset()
  workspacePaneTabsCommitMocks.writeCanonicalWorkspacePaneTabsSnapshot.mockResolvedValue(true)
  workspacePaneTabsQueryMocks.refreshWorkspacePaneTabs.mockReset()
})

afterEach(() => {
  resetReposStore()
})

describe('workspace pane runtime tab create action', () => {
  test('returns no terminal create action without a runtime target', () => {
    const action = workspacePaneRuntimeTabCreateAction('terminal', {
      repoRoot: REPO_ROOT,
      runtimeTabStateByType: runtimeTabState(),
      initialRuntimeProjectionHydrating: false,
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
      repoRoot: REPO_ROOT,
      runtimeTabStateByType: runtimeTabState(),
      initialRuntimeProjectionHydrating: false,
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
    expect(showCreatedRuntimeTab).toHaveBeenCalledWith('terminal', TERMINAL_SESSION_ID)
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
    ).resolves.toEqual({ ok: true, terminalSessionId: TERMINAL_SESSION_ID })

    expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).toHaveBeenCalledWith(
      expect.objectContaining({ base: BASE, commitCreatedTerminalTab: expect.any(Function) }),
    )
  })

  test('applies the server snapshot, records the opener, then commits the exact route', async () => {
    const admission = createAdmission({
      tabs: [
        { type: 'status', tabId: 'workspace-pane:status' },
        { type: 'terminal', runtimeSessionId: TERMINAL_SESSION_ID },
      ],
    })
    const showCreatedTerminalTab = vi.fn(() => {
      expect(workspacePaneTabOpener(REPO_ROOT, BRANCH_NAME, `terminal:${TERMINAL_SESSION_ID}`)).toBe(
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

    expect(workspacePaneTabsCommitMocks.writeCanonicalWorkspacePaneTabsSnapshot).toHaveBeenCalledWith(
      REPO_ROOT,
      REPO_RUNTIME_ID,
      admission.workspacePaneTabs,
    )
    expect(showCreatedTerminalTab).toHaveBeenCalledWith(TERMINAL_SESSION_ID)
    expect(
      workspacePaneTabsCommitMocks.writeCanonicalWorkspacePaneTabsSnapshot.mock.invocationCallOrder[0],
    ).toBeLessThan(showCreatedTerminalTab.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY)
  })

  test('does not navigate when a newer server snapshot supersedes create presentation', async () => {
    workspacePaneTabsCommitMocks.writeCanonicalWorkspacePaneTabsSnapshot.mockResolvedValueOnce(false)
    const showCreatedTerminalTab = vi.fn(() => true)

    await expect(
      commitCreatedTerminalWorkspacePaneRuntimeTab({
        base: BASE,
        admission: createAdmission(),
        openerIdentity: null,
        showCreatedTerminalTab,
      }),
    ).resolves.toEqual({ status: 'superseded' })

    expect(showCreatedTerminalTab).not.toHaveBeenCalled()
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
    expect(workspacePaneTabOpener(REPO_ROOT, BRANCH_NAME, `terminal:${TERMINAL_SESSION_ID}`)).toBeNull()
    expect(useReposStore.getState().repos[REPO_ROOT]?.repoRuntimeId).toBe('repo-runtime-replacement')
  })

  test('refreshes after projection failure without routing an unprojected session', async () => {
    workspacePaneTabsCommitMocks.writeCanonicalWorkspacePaneTabsSnapshot.mockRejectedValueOnce(
      new Error('query projection failed'),
    )
    const showCreatedTerminalTab = vi.fn(() => true)

    await expect(
      commitCreatedTerminalWorkspacePaneRuntimeTab({
        base: BASE,
        admission: createAdmission(),
        openerIdentity: null,
        showCreatedTerminalTab,
      }),
    ).resolves.toEqual({ status: 'projection-failed' })

    expect(workspacePaneTabsQueryMocks.refreshWorkspacePaneTabs).toHaveBeenCalledWith(REPO_ROOT, REPO_RUNTIME_ID)
    expect(showCreatedTerminalTab).not.toHaveBeenCalled()
  })

  test('marks the terminal create action busy while projection or create is pending', () => {
    const pendingAction = workspacePaneRuntimeTabCreateAction('terminal', {
      repoRoot: REPO_ROOT,
      runtimeTabStateByType: runtimeTabState({ createPending: true }),
      initialRuntimeProjectionHydrating: false,
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

    const hydratingAction = workspacePaneRuntimeTabCreateAction('terminal', {
      repoRoot: REPO_ROOT,
      runtimeTabStateByType: runtimeTabState(),
      initialRuntimeProjectionHydrating: true,
      showCreatedRuntimeTab: vi.fn(),
      t: translate,
      terminal: {
        base: BASE,
        createTerminal: vi.fn(async () => createAdmission()),
        captureOpenerIdentity: vi.fn(() => null),
      },
    })
    expect(hydratingAction?.busy).toBe(true)
    expect(hydratingAction?.blocksTabInteraction).toBe(false)
  })
})

function translate(key: string): string {
  return key
}

function createAdmission(input: { tabs?: WorkspacePaneTabEntry[] } = {}): TerminalCreateLeaderAdmissionResult {
  return {
    terminalSessionId: TERMINAL_SESSION_ID,
    requestRole: 'leader',
    resourceDisposition: 'created',
    workspacePaneTabs: {
      revision: 1,
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: BRANCH_NAME,
          worktreePath: WORKTREE_PATH,
          tabs: input.tabs ?? [{ type: 'terminal', runtimeSessionId: TERMINAL_SESSION_ID }],
        },
      ],
    },
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
