import type { TerminalCreateInput, TerminalCreateResult } from '#/shared/terminal-types.ts'
import type {
  TerminalWorkspacePaneRuntimeOpenInput,
  WorkspacePaneRuntimeOpenInput,
  WorkspacePaneRuntimeOpenResult,
} from '#/shared/workspace-pane-runtime.ts'
import type { WorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import { terminalSessionRuntimeScope, terminalSessionWorktreePath } from '#/server/terminal/terminal-session-scope.ts'

interface WorkspacePaneRuntimeApplicationDependencies {
  workspaceTabsCoordinator: Pick<WorkspacePaneTabsCoordinator, 'ensureRuntimeTabForSession'>
  terminal: {
    create(clientId: string, userId: string, input: TerminalCreateInput): Promise<TerminalCreateResult>
  }
  isCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): boolean
  broadcastWorkspaceTabsChanged(userId: string, repoRoot: string): void
}

/**
 * Application operation joining provider lifecycle and workspace-pane
 * projection. Provider services remain independently usable; UI callers use
 * this boundary when they need the created runtime and its canonical tab to
 * become one server-owned outcome.
 */
export class WorkspacePaneRuntimeApplication {
  private readonly deps: WorkspacePaneRuntimeApplicationDependencies

  constructor(deps: WorkspacePaneRuntimeApplicationDependencies) {
    this.deps = deps
  }

  async open(
    clientId: string,
    userId: string,
    input: WorkspacePaneRuntimeOpenInput,
  ): Promise<WorkspacePaneRuntimeOpenResult> {
    switch (input.runtimeType) {
      case 'terminal':
        return await this.openTerminal(clientId, userId, input)
    }
  }

  private async openTerminal(
    clientId: string,
    userId: string,
    input: TerminalWorkspacePaneRuntimeOpenInput,
  ): Promise<WorkspacePaneRuntimeOpenResult> {
    const runtime = await this.deps.terminal.create(clientId, userId, input.request)
    if (!runtime.ok) return { ok: false, runtimeType: 'terminal', message: runtime.message }

    const session = runtime.sessions.find((candidate) => candidate.terminalSessionId === runtime.terminalSessionId)
    const staleFailure = { ok: false, runtimeType: 'terminal', message: 'error.repo-runtime-stale' } as const
    const tabs = await this.deps.workspaceTabsCoordinator.ensureRuntimeTabForSession({
      userId,
      scope: terminalSessionRuntimeScope(input.request.repoRoot, input.request.repoRuntimeId),
      branchName: session?.branch ?? input.request.branch,
      worktreePath:
        session?.worktreePath ?? terminalSessionWorktreePath(input.request.repoRoot, input.request.worktreePath),
      runtimeType: 'terminal',
      sessionId: runtime.terminalSessionId,
      insertAfterIdentity: input.insertAfterIdentity,
      guardBeforeWrite: () =>
        this.deps.isCurrentRepoRuntime(userId, input.request.repoRoot, input.request.repoRuntimeId)
          ? null
          : staleFailure,
    })
    if (!Array.isArray(tabs)) return tabs

    this.deps.broadcastWorkspaceTabsChanged(userId, input.request.repoRoot)
    return { ok: true, runtimeType: 'terminal', runtime, tabs }
  }
}

export function createWorkspacePaneRuntimeApplication(
  deps: WorkspacePaneRuntimeApplicationDependencies,
): WorkspacePaneRuntimeApplication {
  return new WorkspacePaneRuntimeApplication(deps)
}
