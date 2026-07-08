import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { runCreateTerminalTabCommand } from '#/web/commands/terminal-create-command.ts'
import { createRepoBranch, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { TerminalWorktreeSnapshot } from '#/web/components/terminal/types.ts'
import { workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'

const REPO_ID = '/tmp/gbl-terminal-create-command-repo'
const REPO_RUNTIME_ID = 'repo-runtime-terminal-create-command'
const WORKTREE_PATH = '/tmp/gbl-terminal-create-command-worktree'
const WORKTREE_KEY = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)

beforeEach(() => {
  resetReposStore()
  setTerminalSessionCommandBridge(null)
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    name: 'terminal-create-command-repo',
    repoRuntimeId: REPO_RUNTIME_ID,
    branches: [createRepoBranch('main', { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: 'main',
  })
})

afterEach(() => {
  setTerminalSessionCommandBridge(null)
})

describe('terminal create command', () => {
  test('shows the created terminal after the session is created', async () => {
    const createTerminal = vi.fn(async () => 'term-111111111111111111111')
    const showCreatedTerminalTab = vi.fn(() => true)

    await expect(
      runCreateTerminalTabCommand({
        base: {
          repoRoot: REPO_ID,
          repoRuntimeId: REPO_RUNTIME_ID,
          branch: 'main',
          worktreePath: WORKTREE_PATH,
        },
        createTerminal,
        openerIdentity: null,
        showCreatedTerminalTab,
      }),
    ).resolves.toEqual({ ok: true, terminalSessionId: 'term-111111111111111111111' })

    expect(createTerminal).toHaveBeenCalledTimes(1)
    expect(showCreatedTerminalTab).toHaveBeenCalledWith('term-111111111111111111111')
  })

  test('records opener before showing the created terminal route', async () => {
    const createTerminal = vi.fn(async () => 'term-111111111111111111111')
    const showCreatedTerminalTab = vi.fn((terminalSessionId: string) => {
      expect(workspacePaneTabOpener(REPO_ID, 'main', `terminal:${terminalSessionId}`)).toBe('terminal:term-000000000000000000000')
      return true
    })

    await expect(
      runCreateTerminalTabCommand({
        base: {
          repoRoot: REPO_ID,
          repoRuntimeId: REPO_RUNTIME_ID,
          branch: 'main',
          worktreePath: WORKTREE_PATH,
        },
        createTerminal,
        openerIdentity: 'terminal:term-000000000000000000000',
        showCreatedTerminalTab,
      }),
    ).resolves.toEqual({ ok: true, terminalSessionId: 'term-111111111111111111111' })

    expect(showCreatedTerminalTab).toHaveBeenCalledWith('term-111111111111111111111')
    expect(workspacePaneTabOpener(REPO_ID, 'main', 'terminal:term-111111111111111111111')).toBe('terminal:term-000000000000000000000')
  })

  test('reports failure if showing the created terminal route is rejected', async () => {
    const createTerminal = vi.fn(async () => 'term-111111111111111111111')
    const showCreatedTerminalTab = vi.fn(() => false)

    await expect(
      runCreateTerminalTabCommand({
        base: {
          repoRoot: REPO_ID,
          repoRuntimeId: REPO_RUNTIME_ID,
          branch: 'main',
          worktreePath: WORKTREE_PATH,
        },
        createTerminal,
        openerIdentity: 'terminal:term-000000000000000000000',
        showCreatedTerminalTab,
      }),
    ).resolves.toMatchObject({ ok: false, messageKey: 'error.terminal-create-failed' })

    expect(showCreatedTerminalTab).toHaveBeenCalledWith('term-111111111111111111111')
    expect(workspacePaneTabOpener(REPO_ID, 'main', 'terminal:term-111111111111111111111')).toBe('terminal:term-000000000000000000000')
  })

  test('fast-fails before create while a terminal create is already pending for the worktree', async () => {
    const createTerminal = vi.fn(async () => 'term-111111111111111111111')
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
          repoRuntimeId: REPO_RUNTIME_ID,
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

  test('fast-fails before create when the base has no repo runtime id at the trigger boundary', async () => {
    const createTerminal = vi.fn(async () => 'term-111111111111111111111')
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
