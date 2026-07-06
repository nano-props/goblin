import { toast } from 'sonner'
import { createAgentSession } from '#/web/agent-client.ts'
import { closeAgentSessionAndRefresh, setAgentSessionDetail } from '#/web/agent-queries.ts'
import type { AgentSessionBase } from '#/shared/agent-types.ts'
import { updateWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { agentWorkspacePaneTabProvider } from '#/web/components/workspace-pane/tab-providers.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { formatAgentWorktreeKey } from '#/shared/agent-worktree-key.ts'
import { gblLog } from '#/web/logger.ts'
import { recordWorkspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'

export interface RunCreateAgentTabCommandInput {
  base: AgentSessionBase
  openerIdentity?: string | null
  insertAfterIdentity?: string | null
  enterAgentTab: () => void
  t?: (key: string, params?: Record<string, string | number>) => string
}

export type RunCreateAgentTabCommandResult = { ok: true; agentSessionId: string } | { ok: false; message: string }

export async function runCreateAgentTabCommand(
  input: RunCreateAgentTabCommandInput,
): Promise<RunCreateAgentTabCommandResult> {
  const result = await createAgentSession(input.base)
  if (!result.ok) {
    reportAgentCreateFailure(result.message, input.t)
    return result
  }
  const commit = await updateWorkspacePaneTabs({
    repoRoot: input.base.repoRoot,
    repoInstanceId: input.base.repoInstanceId,
    branchName: input.base.branch,
    worktreePath: input.base.worktreePath,
    operation: {
      type: 'open-agent',
      agentSessionId: result.session.agentSessionId,
      insertAfterIdentity: input.insertAfterIdentity ?? null,
    },
  })
  if (!commit.ok) {
    await rollbackCreatedAgentSession(input.base, result.session.agentSessionId)
    reportAgentCreateFailure(commit.message, input.t)
    return { ok: false, message: commit.message }
  }
  await setAgentSessionDetail(result.session)
  if (input.openerIdentity) {
    recordWorkspacePaneTabOpener(
      input.base.repoRoot,
      input.base.branch,
      agentWorkspacePaneIdentity(result.session.agentSessionId),
      input.openerIdentity,
      { id: input.base.repoRoot, repoInstanceId: input.base.repoInstanceId },
    )
  }
  useReposStore
    .getState()
    .setSelectedAgent(
      formatAgentWorktreeKey(input.base.repoRoot, input.base.worktreePath),
      result.session.agentSessionId,
    )
  input.enterAgentTab()
  return { ok: true, agentSessionId: result.session.agentSessionId }
}

async function rollbackCreatedAgentSession(base: AgentSessionBase, agentSessionId: string): Promise<void> {
  try {
    const closed = await closeAgentSessionAndRefresh({
      repoRoot: base.repoRoot,
      repoInstanceId: base.repoInstanceId,
      agentSessionId,
    })
    if (!closed) {
      gblLog.warn('agent tab create rollback did not close session', { agentSessionId })
    }
  } catch (err) {
    gblLog.warn('agent tab create rollback failed', { agentSessionId, err })
  }
}

function reportAgentCreateFailure(message: string, t?: (key: string) => string): void {
  gblLog.warn('agent tab create failed', { message })
  toast.error(t ? t('agent.create-failed') : 'agent.create-failed', { description: t ? t(message) : message })
}

export function agentWorkspacePaneIdentity(agentSessionId: string): string {
  return agentWorkspacePaneTabProvider.identity(agentSessionId)
}
