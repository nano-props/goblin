import path from 'node:path'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import type { TerminalSessionSummary } from '#/shared/terminal-types.ts'
import { localWorkspaceNativePath } from '#/server/modules/workspace-path.ts'

export interface TerminalSessionPruneManager {
  listSessionsForUser(userId: string, scope: string): Promise<TerminalSessionSummary[]>
  requestSessionRetirement(terminalRuntimeSessionId: string): Promise<boolean>
}

export interface TerminalSessionPrunerOptions {
  manager: TerminalSessionPruneManager
}

class TerminalSessionPruner {
  private readonly manager: TerminalSessionPruneManager

  constructor(options: TerminalSessionPrunerOptions) {
    this.manager = options.manager
  }

  async prune(input: {
    userId: string
    repoRoot: string
    scope: string
    assertCurrent: () => void
  }): Promise<{ pruned: number; remaining: number }> {
    const allSessions = await this.manager.listSessionsForUser(input.userId, input.scope)
    if (isRemoteRepoId(input.repoRoot)) return { pruned: 0, remaining: allSessions.length }

    const workspacePath = localWorkspaceNativePath(input.repoRoot)
    if (!workspacePath) throw new Error('error.workspace-locator-malformed')
    const worktrees = await getWorktrees(workspacePath, { includeStatus: false })
    input.assertCurrent()
    const liveWorktreePaths = new Set(worktrees.map((worktree) => path.resolve(worktree.path)))
    let pruned = 0
    for (const session of allSessions) {
      if (session.repoRoot !== input.repoRoot) continue
      if (liveWorktreePaths.has(path.resolve(session.worktreePath))) continue
      if (await this.manager.requestSessionRetirement(session.terminalRuntimeSessionId)) pruned += 1
    }
    const remaining = await this.manager
      .listSessionsForUser(input.userId, input.scope)
      .then((sessions) => sessions.length)
    return { pruned, remaining }
  }
}

export function createTerminalSessionPruner(options: TerminalSessionPrunerOptions): TerminalSessionPruner {
  return new TerminalSessionPruner(options)
}
