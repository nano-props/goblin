import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { runCreateTerminalTabCommand } from '#/web/commands/terminal-create-command.ts'
import { createRepoBranch, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { TerminalWorktreeSnapshot } from '#/web/components/terminal/types.ts'
import { workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'

const REPO_ID = '/tmp/gbl-terminal-create-command-repo'
const REPO_INSTANCE_ID = 'repo-instance-terminal-create-command'
const WORKTREE_PATH = '/tmp/gbl-terminal-create-command-worktree'
const WORKTREE_KEY = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)

beforeEach(() => {
  resetReposStore()
  setTerminalSessionCommandBridge(null)
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    name: 'terminal-create-command-repo',
    instanceId: REPO_INSTANCE_ID,
    branches: [createRepoBranch('main', { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: 'main',
  })
})

afterEach(() => {
  setTerminalSessionCommandBridge(null)
})

describe('terminal create command', () => {
  test('shows the created terminal after the session is created', async () => {
    const createTerminal = vi.fn(async () => 'session-1')
    const showCreatedTerminalTab = vi.fn(() => true)

    await expect(
      runCreateTerminalTabCommand({
        base: {
          repoRoot: REPO_ID,
          repoInstanceId: REPO_INSTANCE_ID,
          branch: 'main',
          worktreePath: WORKTREE_PATH,
        },
        createTerminal,
        openerIdentity: null,
        showCreatedTerminalTab,
      }),
    ).resolves.toEqual({ ok: true, terminalSessionId: 'session-1' })

    expect(createTerminal).toHaveBeenCalledTimes(1)
    expect(showCreatedTerminalTab).toHaveBeenCalledWith('session-1')
  })

  test('records opener before showing the created terminal route', async () => {
    const createTerminal = vi.fn(async () => 'session-1')
    const showCreatedTerminalTab = vi.fn((terminalSessionId: string) => {
      expect(workspacePaneTabOpener(REPO_ID, 'main', `terminal:${terminalSessionId}`)).toBe('terminal:session-0')
      return true
    })

    await expect(
      runCreateTerminalTabCommand({
        base: {
          repoRoot: REPO_ID,
          repoInstanceId: REPO_INSTANCE_ID,
          branch: 'main',
          worktreePath: WORKTREE_PATH,
        },
        createTerminal,
        openerIdentity: 'terminal:session-0',
        showCreatedTerminalTab,
      }),
    ).resolves.toEqual({ ok: true, terminalSessionId: 'session-1' })

    expect(showCreatedTerminalTab).toHaveBeenCalledWith('session-1')
    expect(workspacePaneTabOpener(REPO_ID, 'main', 'terminal:session-1')).toBe('terminal:session-0')
  })

  test('reports failure if showing the created terminal route is rejected', async () => {
    const createTerminal = vi.fn(async () => 'session-1')
    const showCreatedTerminalTab = vi.fn(() => false)

    await expect(
      runCreateTerminalTabCommand({
        base: {
          repoRoot: REPO_ID,
          repoInstanceId: REPO_INSTANCE_ID,
          branch: 'main',
          worktreePath: WORKTREE_PATH,
        },
        createTerminal,
        openerIdentity: 'terminal:session-0',
        showCreatedTerminalTab,
      }),
    ).resolves.toMatchObject({ ok: false, messageKey: 'error.terminal-create-failed' })

    expect(showCreatedTerminalTab).toHaveBeenCalledWith('session-1')
    expect(workspacePaneTabOpener(REPO_ID, 'main', 'terminal:session-1')).toBe('terminal:session-0')
  })

  test('fast-fails before create while a terminal create is already pending for the worktree', async () => {
    const createTerminal = vi.fn(async () => 'session-1')
    const showCreatedTerminalTab = vi.fn(() => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshot({ createPending: true }),
      createTerminal,
      selectTerminal: vi.fn(),
    })

    await expect(
      runCreateTerminalTabCommand({
        base: {
          repoRoot: REPO_ID,
          repoInstanceId: REPO_INSTANCE_ID,
          branch: 'main',
          worktreePath: WORKTREE_PATH,
        },
        createTerminal,
        openerIdentity: null,
        showCreatedTerminalTab,
      }),
    ).resolves.toMatchObject({ ok: false, messageKey: 'error.terminal-create-failed' })

    expect(createTerminal).not.toHaveBeenCalled()
    expect(showCreatedTerminalTab).not.toHaveBeenCalled()
  })

  test('fast-fails before create when the base has no repo instance id at the trigger boundary', async () => {
    const createTerminal = vi.fn(async () => 'session-1')
    const showCreatedTerminalTab = vi.fn(() => true)

    await expect(
      runCreateTerminalTabCommand({
        base: {
          repoRoot: REPO_ID,
          branch: 'main',
          worktreePath: WORKTREE_PATH,
        },
        createTerminal,
        openerIdentity: null,
        showCreatedTerminalTab,
      }),
    ).resolves.toMatchObject({ ok: false, messageKey: 'error.terminal-create-failed' })

    expect(createTerminal).not.toHaveBeenCalled()
    expect(showCreatedTerminalTab).not.toHaveBeenCalled()
  })
})

function worktreeSnapshot(input: { createPending: boolean }): TerminalWorktreeSnapshot {
  return {
    terminalWorktreeKey: WORKTREE_KEY,
    selectedDescriptor: null,
    sessions: [],
    count: 0,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: input.createPending,
  }
}
