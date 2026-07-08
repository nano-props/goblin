import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { runCreateTerminalTabCommand } from '#/web/commands/terminal-create-command.ts'
import { resetReposStore } from '#/web/test-utils/bridge.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { TerminalWorktreeSnapshot } from '#/web/components/terminal/types.ts'

const REPO_ID = '/tmp/gbl-terminal-create-command-repo'
const REPO_INSTANCE_ID = 'repo-instance-terminal-create-command'
const WORKTREE_PATH = '/tmp/gbl-terminal-create-command-worktree'
const WORKTREE_KEY = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)

beforeEach(() => {
  resetReposStore()
  setTerminalSessionCommandBridge(null)
  const repo = emptyRepo(REPO_ID, 'terminal-create-command-repo', REPO_INSTANCE_ID)
  useReposStore.setState({ repos: { [REPO_ID]: repo }, order: [REPO_ID] })
})

afterEach(() => {
  setTerminalSessionCommandBridge(null)
})

describe('terminal create command', () => {
  test('shows the created terminal after the session is created', async () => {
    const createTerminal = vi.fn(async () => 'session-1')
    const showCreatedTerminalTab = vi.fn()

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

  test('fast-fails before create while a terminal create is already pending for the worktree', async () => {
    const createTerminal = vi.fn(async () => 'session-1')
    const showCreatedTerminalTab = vi.fn()
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
    const showCreatedTerminalTab = vi.fn()

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
