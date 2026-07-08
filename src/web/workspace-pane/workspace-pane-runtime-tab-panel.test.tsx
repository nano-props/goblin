// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { stubI18n } from '#/test-utils/i18n-mock.ts'
import { TerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalSessionContextValue } from '#/web/components/terminal/types.ts'
import {
  PrimaryWindowNavigationProvider,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation.tsx'
import { renderWorkspacePaneRuntimeTabPanel } from '#/web/workspace-pane/workspace-pane-runtime-tab-panel.tsx'

stubI18n()

interface CapturedTerminalSessionViewProps {
  repoRoot: string
  repoInstanceId: string
  branch: string
  worktreePath: string
  selectedTerminalSessionId?: string | null
  projectionPhase?: string
  projectionErrorMessage?: string
  createTerminalForSlot?: (base: TerminalSessionBase) => Promise<unknown>
}

const terminalSessionViewMocks = vi.hoisted(() => ({
  props: [] as CapturedTerminalSessionViewProps[],
}))

const terminalCreateCommandMocks = vi.hoisted(() => ({
  runCreateTerminalTabCommand: vi.fn(async () => ({ ok: true as const, terminalSessionId: 'session-1' })),
}))

vi.mock('#/web/components/terminal/TerminalSessionView.tsx', () => ({
  TerminalSessionView: (props: CapturedTerminalSessionViewProps) => {
    terminalSessionViewMocks.props.push(props)
    return <div data-testid="terminal-session-view" />
  },
}))

vi.mock('#/web/commands/terminal-create-command.ts', () => ({
  runCreateTerminalTabCommand: terminalCreateCommandMocks.runCreateTerminalTabCommand,
}))

afterEach(() => {
  terminalSessionViewMocks.props.length = 0
  terminalCreateCommandMocks.runCreateTerminalTabCommand.mockClear()
})

describe('workspace pane runtime tab panel', () => {
  test('renders terminal runtime panel through the runtime panel registry', () => {
    const { container } = renderPanel()

    const panel = container.querySelector('#workspace-terminal-panel')
    expect(panel?.getAttribute('role')).toBe('tabpanel')
    expect(panel?.getAttribute('aria-label')).toBe('Terminal')
    expect(container.querySelector('[data-testid="terminal-session-view"]')).not.toBeNull()
    expect(terminalSessionViewMocks.props[0]).toMatchObject({
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-1',
      branch: 'main',
      worktreePath: '/repo-worktree',
      selectedTerminalSessionId: 'session-1',
      projectionPhase: 'failed',
      projectionErrorMessage: 'boom',
    })
  })

  test('delegates terminal empty-slot create to the terminal create command', async () => {
    const createTerminal = vi.fn(async () => 'session-1')
    const { navigation } = renderPanel({
      terminalContext: terminalCommandContextWith({ createTerminal }),
    })

    const base: TerminalSessionBase = {
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-1',
      branch: 'main',
      worktreePath: '/repo-worktree',
    }

    await act(async () => {
      await terminalSessionViewMocks.props[0]?.createTerminalForSlot?.(base)
    })

    expect(terminalCreateCommandMocks.runCreateTerminalTabCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        base,
        createTerminal,
        openerIdentity: null,
        logMessage: 'workspace pane terminal create failed',
      }),
    )
    const commandCalls = terminalCreateCommandMocks.runCreateTerminalTabCommand.mock.calls as unknown as Array<
      [{ showCreatedTerminalTab: (terminalSessionId: string) => void | Promise<void> }]
    >
    await commandCalls[0]?.[0].showCreatedTerminalTab('session-1')
    expect(navigation.showRepoBranchTerminalSession).toHaveBeenCalledWith('/repo', 'main', 'session-1')
  })
})

function renderPanel(input: { terminalContext?: TerminalSessionContextValue } = {}) {
  const navigation = navigationWith()
  const result = renderInJsdom(
    <PrimaryWindowNavigationProvider value={navigation}>
      <TerminalSessionContext value={input.terminalContext ?? terminalCommandContextWith()}>
        {renderWorkspacePaneRuntimeTabPanel({
          type: 'terminal',
          workspacePaneId: 'workspace',
          panelLabel: { label: 'Terminal' },
          target: {
            repoRoot: '/repo',
            repoInstanceId: 'repo-instance-1',
            branchName: 'main',
            worktreePath: '/repo-worktree',
          },
          selectedSessionId: 'session-1',
          runtimeState: {
            projectionPhase: 'failed',
            projectionErrorMessage: 'boom',
          },
        })}
      </TerminalSessionContext>
    </PrimaryWindowNavigationProvider>,
  )
  return { ...result, navigation }
}

function navigationWith(): PrimaryWindowNavigationActions {
  return {
    activateRepo: vi.fn(),
    closeRepo: vi.fn(),
    cycleRepo: vi.fn(),
    selectRepoBranch: vi.fn(),
    showRepoBranchWorkspacePaneTab: vi.fn(),
    showRepoBranchTerminalSession: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    openSettings: vi.fn(),
    openCreateWorktree: vi.fn(),
  }
}

function terminalCommandContextWith(overrides: Partial<TerminalSessionContextValue> = {}): TerminalSessionContextValue {
  return {
    createTerminal: vi.fn(async () => 'session-1'),
    registerHost: vi.fn(),
    unregisterHost: vi.fn(),
    selectTerminal: vi.fn(),
    scrollToBottom: vi.fn(),
    scrollLines: vi.fn(),
    clearBell: vi.fn(() => false),
    closeTerminalByDescriptor: vi.fn(async () => true),
    attach: vi.fn(),
    detach: vi.fn(),
    restart: vi.fn(),
    isTerminalFocusTarget: vi.fn(() => false),
    findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
    findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
    clearSearch: vi.fn(),
    writeInput: vi.fn(),
    takeover: vi.fn(async () => true),
    focusTerminal: vi.fn(),
    ...overrides,
  }
}
