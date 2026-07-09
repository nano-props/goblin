import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import {
  dispatchCreateTerminalWorkspacePaneRuntimeTabAction,
  type WorkspacePaneRuntimeTabCreateStateByType,
  workspacePaneRuntimeTabCreateAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import {
  resetWorkspacePaneTabCoordinatorForTest,
  runWorkspacePaneTabCoordinatorTask,
} from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'

const terminalCreateCommandMocks = vi.hoisted(() => ({
  runCreateTerminalTabCommand: vi.fn(async () => ({ ok: true as const, terminalSessionId: 'term-111111111111111111111' })),
}))

vi.mock('#/web/commands/terminal-create-command.ts', () => ({
  runCreateTerminalTabCommand: terminalCreateCommandMocks.runCreateTerminalTabCommand,
}))

beforeEach(() => {
  resetWorkspacePaneTabCoordinatorForTest()
})

afterEach(() => {
  resetWorkspacePaneTabCoordinatorForTest()
  terminalCreateCommandMocks.runCreateTerminalTabCommand.mockClear()
})

describe('workspace pane runtime tab create action', () => {
  test('returns no terminal create action without a runtime target', () => {
    const action = workspacePaneRuntimeTabCreateAction('terminal', {
      repoRoot: '/repo',
      runtimeTabStateByType: runtimeTabState(),
      initialRuntimeProjectionHydrating: false,
      showCreatedRuntimeTab: vi.fn(),
      t: translate,
      terminal: {
        base: null,
        createTerminal: vi.fn(async () => 'term-111111111111111111111'),
        captureOpenerIdentity: vi.fn(() => null),
      },
    })

    expect(action).toBeNull()
  })

  test('builds a terminal create action that delegates to the terminal create command', async () => {
    const base: TerminalSessionBase = {
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-1',
      branch: 'main',
      worktreePath: '/repo-worktree',
    }
    const createTerminal = vi.fn(async () => 'term-111111111111111111111')
    const showCreatedRuntimeTab = vi.fn()
    const captureOpenerIdentity = vi.fn(() => 'opener-tab')

    const action = workspacePaneRuntimeTabCreateAction('terminal', {
      repoRoot: '/repo',
      runtimeTabStateByType: runtimeTabState(),
      initialRuntimeProjectionHydrating: false,
      showCreatedRuntimeTab,
      t: translate,
      terminal: {
        base,
        createTerminal,
        captureOpenerIdentity,
      },
    })

    expect(action?.label).toBe('terminal.new')
    expect(action?.busy).toBe(false)
    expect(action?.blocksTabInteraction).toBe(false)
    expect(captureOpenerIdentity).not.toHaveBeenCalled()

    action?.onCreate()

    expect(captureOpenerIdentity).toHaveBeenCalledOnce()
    expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        base,
        createTerminal,
        openerIdentity: 'opener-tab',
        t: translate,
      }),
    )

    const commandCalls = terminalCreateCommandMocks.runCreateTerminalTabCommand.mock.calls as unknown as Array<
      [{ showCreatedTerminalTab: (terminalSessionId: string) => boolean | Promise<boolean> }]
    >
    const commandInput = commandCalls[0]?.[0]
    await commandInput?.showCreatedTerminalTab('term-111111111111111111111')
    expect(showCreatedRuntimeTab).toHaveBeenCalledWith('terminal', 'term-111111111111111111111')
  })

  test('queues terminal create actions behind existing workspace pane tab work for the same target', async () => {
    const base: TerminalSessionBase = {
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-1',
      branch: 'main',
      worktreePath: '/repo-worktree',
    }
    let releaseBlocker!: () => void
    const blocker = runWorkspacePaneTabCoordinatorTask(
      { repoId: base.repoRoot, branchName: base.branch, worktreePath: base.worktreePath },
      async () =>
        await new Promise<void>((resolve) => {
          releaseBlocker = resolve
        }),
    )

    const createPromise = dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
      base,
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      openerIdentity: null,
      t: translate,
    })
    await Promise.resolve()

    expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).not.toHaveBeenCalled()

    releaseBlocker()
    await blocker
    await expect(createPromise).resolves.toEqual({ ok: true, terminalSessionId: 'term-111111111111111111111' })
    expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).toHaveBeenCalledOnce()
  })

  test('marks the terminal create action busy while projection or create is pending', () => {
    const base: TerminalSessionBase = {
      repoRoot: '/repo',
      branch: 'main',
      worktreePath: '/repo-worktree',
    }

    const pendingAction = workspacePaneRuntimeTabCreateAction('terminal', {
      repoRoot: '/repo',
      runtimeTabStateByType: runtimeTabState({ createPending: true }),
      initialRuntimeProjectionHydrating: false,
      showCreatedRuntimeTab: vi.fn(),
      t: translate,
      terminal: {
        base,
        createTerminal: vi.fn(async () => 'term-111111111111111111111'),
        captureOpenerIdentity: vi.fn(() => null),
      },
    })
    expect(pendingAction?.busy).toBe(true)
    expect(pendingAction?.blocksTabInteraction).toBe(true)

    const hydratingAction = workspacePaneRuntimeTabCreateAction('terminal', {
      repoRoot: '/repo',
      runtimeTabStateByType: runtimeTabState(),
      initialRuntimeProjectionHydrating: true,
      showCreatedRuntimeTab: vi.fn(),
      t: translate,
      terminal: {
        base,
        createTerminal: vi.fn(async () => 'term-111111111111111111111'),
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

function runtimeTabState(input: { createPending?: boolean } = {}): WorkspacePaneRuntimeTabCreateStateByType {
  return {
    terminal: {
      createPending: input.createPending ?? false,
    },
  }
}
