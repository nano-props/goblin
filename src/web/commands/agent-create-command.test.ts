// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { runCreateAgentTabCommand } from '#/web/commands/agent-create-command.ts'
import { formatAgentWorktreeKey } from '#/shared/agent-worktree-key.ts'
import type { AgentSessionBase, AgentSessionDetail } from '#/shared/agent-types.ts'
import { createRepoBranch, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'

const agentClientMocks = vi.hoisted(() => ({
  createAgentSession: vi.fn(),
}))
const agentQueryMocks = vi.hoisted(() => ({
  setAgentSessionDetail: vi.fn(),
  closeAgentSessionAndRefresh: vi.fn(),
}))
const workspacePaneTabsMocks = vi.hoisted(() => ({
  updateWorkspacePaneTabs: vi.fn(),
}))
const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}))

vi.mock('#/web/agent-client.ts', () => ({
  createAgentSession: agentClientMocks.createAgentSession,
}))

vi.mock('#/web/agent-queries.ts', () => ({
  setAgentSessionDetail: agentQueryMocks.setAgentSessionDetail,
  closeAgentSessionAndRefresh: agentQueryMocks.closeAgentSessionAndRefresh,
}))

vi.mock('#/web/workspace-pane/workspace-pane-tabs-commit.ts', () => ({
  updateWorkspacePaneTabs: workspacePaneTabsMocks.updateWorkspacePaneTabs,
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastMocks.error,
  },
}))

const REPO_ID = '/tmp/gbl-agent-create-command-repo'
const BRANCH = 'feature/agent'
const WORKTREE_PATH = '/tmp/gbl-agent-create-command-worktree'

beforeEach(() => {
  resetReposStore()
  agentClientMocks.createAgentSession.mockReset()
  agentQueryMocks.setAgentSessionDetail.mockReset()
  agentQueryMocks.closeAgentSessionAndRefresh.mockReset()
  workspacePaneTabsMocks.updateWorkspacePaneTabs.mockReset()
  toastMocks.error.mockReset()
  agentQueryMocks.setAgentSessionDetail.mockResolvedValue(undefined)
  agentQueryMocks.closeAgentSessionAndRefresh.mockResolvedValue(true)
})

describe('runCreateAgentTabCommand', () => {
  test('opens the created agent tab, records its opener, and keeps opener separate from insertion', async () => {
    const base = seedAgentRepo()
    const session = agentSession('agent-1', base)
    agentClientMocks.createAgentSession.mockResolvedValue({ ok: true, session })
    workspacePaneTabsMocks.updateWorkspacePaneTabs.mockResolvedValue({ ok: true })
    const enterAgentTab = vi.fn()

    await expect(
      runCreateAgentTabCommand({
        base,
        openerIdentity: 'workspace-pane:status',
        enterAgentTab,
      }),
    ).resolves.toEqual({ ok: true, agentSessionId: 'agent-1' })

    expect(workspacePaneTabsMocks.updateWorkspacePaneTabs).toHaveBeenCalledWith({
      repoRoot: REPO_ID,
      repoInstanceId: base.repoInstanceId,
      branchName: BRANCH,
      worktreePath: WORKTREE_PATH,
      operation: {
        type: 'open-agent',
        agentSessionId: 'agent-1',
        insertAfterIdentity: null,
      },
    })
    expect(agentQueryMocks.setAgentSessionDetail).toHaveBeenCalledWith(session)
    expect(agentQueryMocks.closeAgentSessionAndRefresh).not.toHaveBeenCalled()
    expect(workspacePaneTabOpener(REPO_ID, BRANCH, 'agent:agent-1')).toBe('workspace-pane:status')
    expect(
      useReposStore.getState().selectedAgentSessionIdByAgentWorktree[formatAgentWorktreeKey(REPO_ID, WORKTREE_PATH)],
    ).toBe('agent-1')
    expect(enterAgentTab).toHaveBeenCalledTimes(1)
  })

  test('rolls back the created session when opening the workspace tab fails', async () => {
    const base = seedAgentRepo()
    agentClientMocks.createAgentSession.mockResolvedValue({ ok: true, session: agentSession('agent-2', base) })
    workspacePaneTabsMocks.updateWorkspacePaneTabs.mockResolvedValue({
      ok: false,
      operation: 'update',
      repoRoot: REPO_ID,
      branchName: BRANCH,
      worktreePath: WORKTREE_PATH,
      message: 'workspace tabs failed',
      error: new Error('workspace tabs failed'),
    })
    const enterAgentTab = vi.fn()

    await expect(
      runCreateAgentTabCommand({ base, openerIdentity: 'workspace-pane:status', enterAgentTab }),
    ).resolves.toEqual({
      ok: false,
      message: 'workspace tabs failed',
    })

    expect(agentQueryMocks.closeAgentSessionAndRefresh).toHaveBeenCalledWith({
      repoRoot: REPO_ID,
      repoInstanceId: base.repoInstanceId,
      agentSessionId: 'agent-2',
    })
    expect(agentQueryMocks.setAgentSessionDetail).not.toHaveBeenCalled()
    expect(
      useReposStore.getState().selectedAgentSessionIdByAgentWorktree[formatAgentWorktreeKey(REPO_ID, WORKTREE_PATH)],
    ).toBe(undefined)
    expect(enterAgentTab).not.toHaveBeenCalled()
    expect(toastMocks.error).toHaveBeenCalledTimes(1)
  })
})

function seedAgentRepo(): AgentSessionBase {
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch(BRANCH, { worktree: { path: WORKTREE_PATH } })],
    selectedBranch: BRANCH,
    preferredWorkspacePaneTab: 'status',
    workspacePaneTabsByBranch: { [BRANCH]: [] },
  })
  const repoInstanceId = useReposStore.getState().repos[REPO_ID]?.instanceId
  if (!repoInstanceId) throw new Error('missing seeded repo')
  return {
    repoRoot: REPO_ID,
    repoInstanceId,
    branch: BRANCH,
    worktreePath: WORKTREE_PATH,
  }
}

function agentSession(agentSessionId: string, base: AgentSessionBase): AgentSessionDetail {
  return {
    type: 'agent',
    agentSessionId,
    repoRoot: base.repoRoot,
    repoInstanceId: base.repoInstanceId,
    branch: base.branch,
    worktreePath: base.worktreePath,
    title: agentSessionId,
    adapterKind: 'builtin',
    phase: 'idle',
    messageCount: 0,
    updatedAt: 1,
    messages: [],
  }
}
