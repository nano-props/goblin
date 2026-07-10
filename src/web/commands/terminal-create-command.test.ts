import { beforeEach, describe, expect, test, vi } from 'vitest'
import { runCreateTerminalTabCommand } from '#/web/commands/terminal-create-command.ts'
import { createRepoBranch, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { recordWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import type { TerminalCreateAdmissionResult } from '#/web/components/terminal/terminal-create-admission.ts'

const REPO_ID = '/tmp/gbl-terminal-create-command-repo'
const REPO_RUNTIME_ID = 'repo-runtime-terminal-create-command'
const WORKTREE_PATH = '/tmp/gbl-terminal-create-command-worktree'

beforeEach(() => {
  resetReposStore()
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    name: 'terminal-create-command-repo',
    repoRuntimeId: REPO_RUNTIME_ID,
    branches: [createRepoBranch('main', { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: 'main',
  })
})

describe('terminal create command', () => {
  test('shows the created terminal after the session is created', async () => {
    const createTerminal = vi.fn(async () => createAdmission())
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

  test('passes runtime placement into the application operation and commits its canonical tabs', async () => {
    const tabs = [{ type: 'terminal' as const, runtimeSessionId: 'term-111111111111111111111' }]
    const createTerminal = vi.fn(async () => ({
      terminalSessionId: 'term-111111111111111111111',
      requestRole: 'leader' as const,
      resourceDisposition: 'created' as const,
      workspacePaneTabs: tabs,
      runtimeProjectionApplied: true,
    }))
    const commitCreatedTerminalTab = vi.fn(() => ({
      workspacePaneProjectionApplied: true,
      navigationCommitted: true,
    }))

    await expect(
      runCreateTerminalTabCommand({
        base: {
          repoRoot: REPO_ID,
          repoRuntimeId: REPO_RUNTIME_ID,
          branch: 'main',
          worktreePath: WORKTREE_PATH,
        },
        createTerminal,
        openerIdentity: 'workspace-pane:status',
        insertAfterIdentity: 'workspace-pane:status',
        commitCreatedTerminalTab,
      }),
    ).resolves.toEqual({ ok: true, terminalSessionId: 'term-111111111111111111111' })

    expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({ repoRoot: REPO_ID }), undefined, {
      insertAfterIdentity: 'workspace-pane:status',
    })
    expect(commitCreatedTerminalTab).toHaveBeenCalledWith('term-111111111111111111111', tabs)
  })

  test('records opener before showing the created terminal route', async () => {
    const createTerminal = vi.fn(async () => createAdmission())
    const showCreatedTerminalTab = vi.fn((terminalSessionId: string) => {
      expect(workspacePaneTabOpener(REPO_ID, 'main', `terminal:${terminalSessionId}`)).toBe(
        'terminal:term-000000000000000000000',
      )
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
    expect(workspacePaneTabOpener(REPO_ID, 'main', 'terminal:term-111111111111111111111')).toBe(
      'terminal:term-000000000000000000000',
    )
  })

  test('does not repeat opener or navigation side effects for duplicate create joiners', async () => {
    const createTerminal = vi.fn(async () => ({
      terminalSessionId: 'term-111111111111111111111',
      requestRole: 'observer' as const,
      resourceDisposition: 'created' as const,
      workspacePaneTabs: [],
      runtimeProjectionApplied: true,
    }))
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
        openerIdentity: 'terminal:term-000000000000000000000',
        showCreatedTerminalTab,
      }),
    ).resolves.toEqual({ ok: true, terminalSessionId: 'term-111111111111111111111' })

    expect(showCreatedTerminalTab).not.toHaveBeenCalled()
    expect(workspacePaneTabOpener(REPO_ID, 'main', 'terminal:term-111111111111111111111')).toBeNull()
  })

  test('reports navigation failure without destroying the committed terminal session', async () => {
    const createTerminal = vi.fn(async () => ({
      terminalSessionId: 'term-111111111111111111111',
      requestRole: 'leader' as const,
      resourceDisposition: 'created' as const,
      workspacePaneTabs: [],
      runtimeProjectionApplied: true,
    }))
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
    expect(workspacePaneTabOpener(REPO_ID, 'main', 'terminal:term-111111111111111111111')).toBe(
      'terminal:term-000000000000000000000',
    )
  })

  test('reports workspace commit failure without destroying the created terminal session', async () => {
    const createTerminal = vi.fn(async () => ({
      terminalSessionId: 'term-111111111111111111111',
      requestRole: 'leader' as const,
      resourceDisposition: 'created' as const,
      workspacePaneTabs: [],
      runtimeProjectionApplied: true,
    }))
    const commitCreatedTerminalTab = vi.fn(() => {
      throw new Error('workspace tabs update failed')
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
        commitCreatedTerminalTab,
      }),
    ).resolves.toMatchObject({ ok: false, messageKey: 'error.terminal-create-failed' })

    expect(commitCreatedTerminalTab).toHaveBeenCalledWith('term-111111111111111111111', [])
    expect(workspacePaneTabOpener(REPO_ID, 'main', 'terminal:term-111111111111111111111')).toBe(
      'terminal:term-000000000000000000000',
    )
  })

  test.each(['reused', 'restored'] as const)(
    'does not overwrite an existing opener when the server reports %s',
    async (resourceDisposition) => {
      const terminalSessionId = 'term-111111111111111111111'
      const existingOpener = 'workspace-pane:status'
      recordWorkspacePaneTabOpener(REPO_ID, 'main', `terminal:${terminalSessionId}`, existingOpener)
      const createTerminal = vi.fn(async () => ({
        terminalSessionId,
        requestRole: 'leader' as const,
        resourceDisposition,
        workspacePaneTabs: [],
        runtimeProjectionApplied: true,
      }))

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
          showCreatedTerminalTab: () => true,
        }),
      ).resolves.toEqual({ ok: true, terminalSessionId })

      expect(workspacePaneTabOpener(REPO_ID, 'main', `terminal:${terminalSessionId}`)).toBe(existingOpener)
    },
  )

  test('reports provider create failure without finishing the terminal route', async () => {
    const createTerminal = vi.fn(async () => {
      throw new Error('provider create failed')
    })
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
    ).resolves.toMatchObject({ ok: false, messageKey: 'error.terminal-create-failed' })

    expect(createTerminal).toHaveBeenCalledTimes(1)
    expect(showCreatedTerminalTab).not.toHaveBeenCalled()
  })

  test('fast-fails before create when the base has no repo runtime id at the trigger boundary', async () => {
    const createTerminal = vi.fn(async () => createAdmission())
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

function createAdmission(overrides: Partial<TerminalCreateAdmissionResult> = {}): TerminalCreateAdmissionResult {
  return {
    terminalSessionId: 'term-111111111111111111111',
    requestRole: 'leader',
    resourceDisposition: 'created',
    workspacePaneTabs: [],
    runtimeProjectionApplied: true,
    ...overrides,
  }
}
