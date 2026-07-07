import { beforeEach, describe, expect, test, vi } from 'vitest'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { runCreateTerminalTabCommand } from '#/web/commands/terminal-create-command.ts'
import { resetReposStore } from '#/web/test-utils/bridge.ts'

const REPO_ID = '/tmp/gbl-terminal-create-command-repo'
const REPO_INSTANCE_ID = 'repo-instance-terminal-create-command'

beforeEach(() => {
  resetReposStore()
  const repo = emptyRepo(REPO_ID, 'terminal-create-command-repo', REPO_INSTANCE_ID)
  useReposStore.setState({ repos: { [REPO_ID]: repo }, order: [REPO_ID] })
})

describe('terminal create command', () => {
  test('does not show the created terminal when the focus guard rejects the late result', async () => {
    const createTerminal = vi.fn(async () => 'session-1')
    const showCreatedTerminalTab = vi.fn()

    await expect(
      runCreateTerminalTabCommand({
        base: {
          repoRoot: REPO_ID,
          repoInstanceId: REPO_INSTANCE_ID,
          branch: 'main',
          worktreePath: '/tmp/gbl-terminal-create-command-worktree',
        },
        createTerminal,
        openerIdentity: null,
        showCreatedTerminalTab,
        shouldShowCreatedTerminalTab: () => false,
      }),
    ).resolves.toEqual({ ok: true, terminalSessionId: 'session-1' })

    expect(createTerminal).toHaveBeenCalledTimes(1)
    expect(showCreatedTerminalTab).not.toHaveBeenCalled()
  })
})
