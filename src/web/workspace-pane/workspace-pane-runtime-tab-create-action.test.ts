import { afterEach, describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import {
  type WorkspacePaneRuntimeTabCreateStateByType,
  workspacePaneRuntimeTabCreateAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'

const terminalCreateCommandMocks = vi.hoisted(() => ({
  runCreateTerminalTabCommand: vi.fn(async () => ({ ok: true as const, terminalSessionId: 'session-1' })),
}))

const workspacePaneTabOpenerMocks = vi.hoisted(() => {
  const shouldShowCreatedTerminalTab = vi.fn(() => true)
  return {
    captureWorkspacePaneActiveTabIdentity: vi.fn(() => 'opener-tab'),
    shouldShowCreatedTerminalTab,
    captureWorkspacePaneTabFocusGuard: vi.fn(() => shouldShowCreatedTerminalTab),
  }
})

vi.mock('#/web/commands/terminal-create-command.ts', () => ({
  runCreateTerminalTabCommand: terminalCreateCommandMocks.runCreateTerminalTabCommand,
}))

vi.mock('#/web/workspace-pane/workspace-pane-tab-opener.ts', () => ({
  captureWorkspacePaneActiveTabIdentity: workspacePaneTabOpenerMocks.captureWorkspacePaneActiveTabIdentity,
  captureWorkspacePaneTabFocusGuard: workspacePaneTabOpenerMocks.captureWorkspacePaneTabFocusGuard,
}))

afterEach(() => {
  terminalCreateCommandMocks.runCreateTerminalTabCommand.mockClear()
  workspacePaneTabOpenerMocks.captureWorkspacePaneActiveTabIdentity.mockClear()
  workspacePaneTabOpenerMocks.captureWorkspacePaneTabFocusGuard.mockClear()
  workspacePaneTabOpenerMocks.shouldShowCreatedTerminalTab.mockClear()
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
        createTerminal: vi.fn(),
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
    const createOwnedTerminal = vi.fn(async () => 'session-1')
    const showCreatedRuntimeTab = vi.fn()

    const action = workspacePaneRuntimeTabCreateAction('terminal', {
      repoRoot: '/repo',
      runtimeTabStateByType: runtimeTabState(),
      initialRuntimeProjectionHydrating: false,
      showCreatedRuntimeTab,
      t: translate,
      terminal: {
        base,
        createTerminal,
        createOwnedTerminal,
      },
    })

    expect(action?.label).toBe('terminal.new')
    expect(action?.busy).toBe(false)

    action?.onCreate()

    expect(workspacePaneTabOpenerMocks.captureWorkspacePaneActiveTabIdentity).toHaveBeenCalledWith('/repo', 'main')
    expect(workspacePaneTabOpenerMocks.captureWorkspacePaneTabFocusGuard).toHaveBeenCalledWith('/repo', 'main')
    expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        base,
        createTerminal,
        createOwnedTerminal,
        openerIdentity: 'opener-tab',
        shouldShowCreatedTerminalTab: workspacePaneTabOpenerMocks.shouldShowCreatedTerminalTab,
        t: translate,
      }),
    )

    const commandCalls = terminalCreateCommandMocks.runCreateTerminalTabCommand.mock.calls as unknown as Array<
      [{ showCreatedTerminalTab: (terminalSessionId: string) => void | Promise<void> }]
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

    expect(
      workspacePaneRuntimeTabCreateAction('terminal', {
        repoRoot: '/repo',
        runtimeTabStateByType: runtimeTabState({ createPending: true }),
        initialRuntimeProjectionHydrating: false,
        showCreatedRuntimeTab: vi.fn(),
        t: translate,
        terminal: {
          base,
          createTerminal: vi.fn(),
        },
      })?.busy,
    ).toBe(true)

    expect(
      workspacePaneRuntimeTabCreateAction('terminal', {
        repoRoot: '/repo',
        runtimeTabStateByType: runtimeTabState(),
        initialRuntimeProjectionHydrating: true,
        showCreatedRuntimeTab: vi.fn(),
        t: translate,
        terminal: {
          base,
          createTerminal: vi.fn(),
        },
      })?.busy,
    ).toBe(true)
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
