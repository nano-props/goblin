import { afterEach, describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import {
  type WorkspacePaneRuntimeTabCreateStateByType,
  workspacePaneRuntimeTabCreateAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'

const terminalCreateCommandMocks = vi.hoisted(() => ({
  runCreateTerminalTabCommand: vi.fn(async () => ({ ok: true as const, terminalSessionId: 'session-1' })),
}))

vi.mock('#/web/commands/terminal-create-command.ts', () => ({
  runCreateTerminalTabCommand: terminalCreateCommandMocks.runCreateTerminalTabCommand,
}))

afterEach(() => {
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
        createTerminal: vi.fn(async () => 'session-1'),
        captureOpenerIdentity: vi.fn(() => null),
      },
    })

    expect(action).toBeNull()
  })

  test('builds a terminal create action that delegates to the terminal create command', async () => {
    const base: TerminalSessionBase = {
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-1',
      branch: 'main',
      worktreePath: '/repo-worktree',
    }
    const createTerminal = vi.fn(async () => 'session-1')
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
    await commandInput?.showCreatedTerminalTab('session-1')
    expect(showCreatedRuntimeTab).toHaveBeenCalledWith('terminal', 'session-1')
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
        createTerminal: vi.fn(async () => 'session-1'),
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
        createTerminal: vi.fn(async () => 'session-1'),
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
