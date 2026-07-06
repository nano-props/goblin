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
    const enterRuntimeTab = vi.fn()
    const createTerminal = vi.fn(async () => 'created-session')
    const selectTerminal = vi.fn()
    const bridge: TerminalSessionCommandBridge = {
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: '/repo\0/repo-worktree',
        selectedDescriptor: null,
        sessions: [
          terminalSession('session-1', true),
          terminalSession('session-2', false),
        ],
        count: 2,
        bellCount: 0,
        outputActiveCount: 0,
        pendingCreate: false,
      }),
      createTerminal,
      selectTerminal,
    }

    await expect(
      runWorkspacePaneRuntimePrimaryAction('terminal', {
        enterRuntimeTab,
        terminal: {
          base: terminalBase,
          bridge,
          openerIdentity: null,
        },
      }),
    ).resolves.toBe(true)

    expect(enterRuntimeTab).toHaveBeenCalledWith('terminal')
    expect(selectTerminal).toHaveBeenCalledWith('/repo\0/repo-worktree', 'session-1')
    expect(createTerminal).not.toHaveBeenCalled()
  })

  test('primary terminal action enters the runtime tab when no bridge is available', async () => {
    const enterRuntimeTab = vi.fn()

    await expect(
      runWorkspacePaneRuntimePrimaryAction('terminal', {
        enterRuntimeTab,
        terminal: {
          base: terminalBase,
          bridge: null,
          openerIdentity: null,
        },
      }),
    ).resolves.toBe(true)

    expect(enterRuntimeTab).toHaveBeenCalledWith('terminal')
  })

  test('new terminal action rejects when no runtime base is available', async () => {
    await expect(
      runWorkspacePaneRuntimeNewAction('terminal', {
        enterRuntimeTab: vi.fn(),
        terminal: {
          base: null,
          bridge: null,
          openerIdentity: null,
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
    index: terminalSessionId === 'session-1' ? 1 : 2,
    title: terminalSessionId,
    fullTitle: terminalSessionId,
    originalTitle: terminalSessionId,
    phase: 'open' as const,
    selected,
    hasBell: false,
    hasRecentOutput: false,
  }
}
