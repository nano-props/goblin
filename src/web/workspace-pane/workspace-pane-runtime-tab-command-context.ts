import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { WorkspacePaneRuntimeTabCommandContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-command-actions.ts'
import { captureWorkspacePaneActiveTabIdentity } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { resolveWorkspacePaneTabTargetForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'

type WorkspacePaneCommandRoute = RepoBranchWorkspacePaneRoute | null | undefined

export interface WorkspacePaneRuntimeTabCommandContextInput {
  repoId: string
  branchName: string
  workspacePaneRoute: WorkspacePaneCommandRoute
  showRuntimeTab: (type: WorkspacePaneRuntimeTabType, sessionId: string) => void | Promise<void>
  terminalCreateTranslator?: TerminalCreateTranslator
}

interface WorkspacePaneRuntimeTabCommandContextResolver {
  assign: (context: WorkspacePaneRuntimeTabCommandContext, input: WorkspacePaneRuntimeTabCommandContextInput) => void
}

const WORKSPACE_PANE_RUNTIME_TAB_COMMAND_CONTEXT_RESOLVERS_BY_TYPE: Record<
  WorkspacePaneRuntimeTabType,
  WorkspacePaneRuntimeTabCommandContextResolver
> = {
  terminal: {
    assign: assignTerminalRuntimeTabCommandContext,
  },
}

export function workspacePaneRuntimeTabCommandContext(
  input: WorkspacePaneRuntimeTabCommandContextInput,
): WorkspacePaneRuntimeTabCommandContext {
  const context: WorkspacePaneRuntimeTabCommandContext = {}
  for (const resolver of Object.values(WORKSPACE_PANE_RUNTIME_TAB_COMMAND_CONTEXT_RESOLVERS_BY_TYPE)) {
    resolver.assign(context, input)
  }
  return context
}

function assignTerminalRuntimeTabCommandContext(
  context: WorkspacePaneRuntimeTabCommandContext,
  input: WorkspacePaneRuntimeTabCommandContextInput,
): void {
  context.terminal = {
    base: selectedTerminalBase(input.repoId, input.branchName, input.workspacePaneRoute),
    bridge: readTerminalSessionCommandBridge(),
    openerIdentity: captureWorkspacePaneActiveTabIdentity(input.repoId, input.branchName, {
      workspacePaneRoute: input.workspacePaneRoute,
    }),
    showTerminalSession: (terminalSessionId) => input.showRuntimeTab('terminal', terminalSessionId),
    t: input.terminalCreateTranslator,
  }
}

function selectedTerminalBase(
  repoId: string,
  branchName: string,
  workspacePaneRoute: WorkspacePaneCommandRoute,
): TerminalSessionBase | null {
  const repo = useReposStore.getState().repos[repoId]
  const target = selectedRepoWorkspaceTargetForRuntimeCommand(repoId, branchName, workspacePaneRoute)
  if (!repo || !target?.worktreePath) return null
  return {
    repoRoot: repoId,
    repoInstanceId: repo.instanceId,
    branch: target.branchName,
    worktreePath: target.worktreePath,
  }
}

function selectedRepoWorkspaceTargetForRuntimeCommand(
  repoId: string,
  branchName: string,
  workspacePaneRoute: WorkspacePaneCommandRoute,
): { branchName: string; worktreePath: string | null } | null {
  const resolution = resolveWorkspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute })
  if (resolution.kind !== 'ready') return null
  if (!resolution.target.branchName) return null
  return { branchName: resolution.target.branchName, worktreePath: resolution.target.worktreePath }
}
