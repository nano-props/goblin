import { describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { TerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  runWorkspacePaneRuntimeNewAction,
  runWorkspacePaneRuntimePrimaryAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-command-actions.ts'

const terminalBase: TerminalSessionBase = {
  repoRoot: '/repo',
  branch: 'main',
  worktreePath: '/repo-worktree',
}

describe('workspace pane runtime tab command actions', () => {
  test('primary terminal action focuses the first existing runtime session', async () => {
    const createTerminal = vi.fn(async () => 'created-session')
    const selectTerminal = vi.fn()
    const showTerminalSession = vi.fn(() => true)
    const bridge: TerminalSessionCommandBridge = {
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: '/repo\0/repo-worktree',
        selectedDescriptor: null,
        sessions: [terminalSession('term-111111111111111111111', true), terminalSession('term-222222222222222222222', false)],
        count: 2,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: false,
      }),
      createTerminal,
      selectTerminal,
    }

    await expect(
      runWorkspacePaneRuntimePrimaryAction('terminal', {
        terminal: {
          base: terminalBase,
          bridge,
          openerIdentity: null,
          showTerminalSession,
        },
      }),
    ).resolves.toBe(true)

    expect(showTerminalSession).toHaveBeenCalledWith('term-111111111111111111111')
    expect(selectTerminal).not.toHaveBeenCalled()
    expect(createTerminal).not.toHaveBeenCalled()
  })

  test('terminal actions no-op while a terminal create is pending', async () => {
    const createTerminal = vi.fn(async () => 'created-session')
    const showTerminalSession = vi.fn(() => true)
    const bridge: TerminalSessionCommandBridge = {
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: '/repo\0/repo-worktree',
        selectedDescriptor: null,
        sessions: [terminalSession('term-111111111111111111111', true)],
        count: 1,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: true,
      }),
      createTerminal,
      selectTerminal: vi.fn(),
    }

    await expect(
      runWorkspacePaneRuntimePrimaryAction('terminal', {
        terminal: {
          base: terminalBase,
          bridge,
          openerIdentity: null,
          showTerminalSession,
        },
      }),
    ).resolves.toBe(true)
    await expect(
      runWorkspacePaneRuntimeNewAction('terminal', {
        terminal: {
          base: terminalBase,
          bridge,
          openerIdentity: null,
          showTerminalSession,
        },
      }),
    ).resolves.toBe(true)

    expect(showTerminalSession).not.toHaveBeenCalled()
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
