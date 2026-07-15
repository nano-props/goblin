import type { ServerRepoMutationHost } from '#/server/repo-mutation/repo-mutation-host.ts'
import type { ServerWorkspacePaneTargetLifecycleHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'

export function createRepoMutationApplication(deps: {
  workspacePaneTabs: ServerWorkspacePaneTargetLifecycleHost
}): ServerRepoMutationHost {
  return {
    async deleteBranch(userId, input) {
      const result = await input.deleteBranch()
      if (!result.ok) return result
      await deps.workspacePaneTabs.retireTarget(userId, {
        repoRuntimeId: input.repoRuntimeId,
        target: { kind: 'branch', repoRoot: input.repoRoot, branchName: input.branchName },
      })
      return result
    },
  }
}
