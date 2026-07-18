import {
  terminalExecutionCoordinates,
  terminalExecutionPath,
  type TerminalPresentation,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { WorkspacePaneRuntimeTabCommandContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-command-actions.ts'
import { captureWorkspacePaneActiveTabIdentity } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import {
  resolveWorkspacePaneTabTargetForBranch,
  workspacePaneTabTargetForWorkspace,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'

type WorkspacePaneCommandRoute = ParsedRepoBranchWorkspacePaneRoute | null | undefined

export interface WorkspacePaneRuntimeTabCommandContextInput {
  repoId: string
  branchName: string | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  showRuntimeTab: (type: WorkspacePaneRuntimeTabType, sessionId: string) => boolean | Promise<boolean>
  showCreatedRuntimeTab: (
    type: WorkspacePaneRuntimeTabType,
    sessionId: string,
    presentation: TerminalPresentation,
    worktreePath: string,
  ) => boolean | Promise<boolean>
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
  const base = selectedWorkspacePaneTerminalBase(input.repoId, input.branchName, input.workspacePaneRoute)
  context.terminal = {
    base,
    bridge: readTerminalSessionCommandBridge(),
    openerIdentity: captureWorkspacePaneActiveTabIdentity(
      input.repoId,
      useReposStore.getState().repos[input.repoId]?.repoRuntimeId ?? '',
      input.branchName,
      {
        workspacePaneRoute: input.workspacePaneRoute,
      },
    ),
    showTerminalSession: (terminalSessionId) => input.showRuntimeTab('terminal', terminalSessionId),
    showCreatedTerminalSession: (terminalSessionId, presentation) =>
      base
        ? input.showCreatedRuntimeTab(
            'terminal',
            terminalSessionId,
            presentation,
            terminalExecutionPath(base.target),
          )
        : false,
    t: input.terminalCreateTranslator,
  }
}

export function selectedWorkspacePaneTerminalBase(
  repoId: string,
  branchName: string | null,
  workspacePaneRoute: WorkspacePaneCommandRoute,
): TerminalSessionBase | null {
  const repo = useReposStore.getState().repos[repoId]
  const target = selectedWorkspacePaneTargetForRuntimeCommand(repoId, branchName, workspacePaneRoute)
  if (!repo || !target) return null
  const runtimeTarget = runtimeWorkspacePaneTarget(target.paneTarget, repo.repoRuntimeId)
  if (!runtimeTarget) return null
  if (runtimeTarget.kind === 'workspace-root') {
    return { target: runtimeTarget, presentation: { kind: 'workspace-root' } }
  }
  if (runtimeTarget.kind === 'git-worktree' && target.terminalBranch) {
    return { target: runtimeTarget, presentation: { kind: 'git-worktree', branchName: target.terminalBranch } }
  }
  return null
}

function selectedWorkspacePaneTargetForRuntimeCommand(
  repoId: string,
  branchName: string | null,
  workspacePaneRoute: WorkspacePaneCommandRoute,
): {
  paneTarget: Parameters<typeof runtimeWorkspacePaneTarget>[0]
  terminalBranch: string | null
  worktreePath: string
} | null {
  if (branchName === null) {
    const target = workspacePaneTabTargetForWorkspace(repoId, { workspacePaneRoute })
    return target
      ? {
          paneTarget: { kind: 'workspace-root', repoRoot: repoId, branchName: null, worktreePath: null },
          terminalBranch: null,
          worktreePath: repoId,
        }
      : null
  }
  const resolution = resolveWorkspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute })
  if (resolution.kind !== 'ready') return null
  if (!resolution.target.branchName) return null
  if (!resolution.target.worktreePath) return null
  return {
    paneTarget: {
      repoRoot: repoId,
      branchName: resolution.target.branchName,
      worktreePath: resolution.target.worktreePath,
    },
    terminalBranch: resolution.target.branchName,
    worktreePath: resolution.target.worktreePath,
  }
}
