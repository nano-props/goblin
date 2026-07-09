import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { TerminalCreateOptions } from '#/web/components/terminal/types.ts'
import { runWorkspacePaneTabCoordinatorTask } from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'

export function withWorkspacePaneTerminalCreateCoordination(
  base: TerminalSessionBase,
  options: TerminalCreateOptions = {},
): TerminalCreateOptions {
  const existingCoordinateCreate = options.coordinateCreate
  return {
    ...options,
    coordinateCreate: async (operation) =>
      await runWorkspacePaneTabCoordinatorTask(
        { repoId: base.repoRoot, branchName: base.branch, worktreePath: base.worktreePath },
        async () => {
          if (existingCoordinateCreate) return await existingCoordinateCreate(operation)
          return await operation()
        },
      ),
  }
}
