import { useReposStore } from '#/web/stores/repos/store.ts'
import type { TerminalSessionBase } from '#/web/components/terminal/types.ts'

export async function createWorkspacePaneTerminalTab(input: {
  base: TerminalSessionBase
  createTerminal: (base: TerminalSessionBase) => Promise<string>
}): Promise<string> {
  // Only publish the tab after the projection has created a concrete session key.
  const key = await input.createTerminal(input.base)
  // Add the tab, switch to the terminal view, and select the new terminal
  // in a single atomic store update. Keeping the three writes together
  // prevents intermediate renders where the tab exists but the workspace
  // pane is still showing another view (or another terminal) because the
  // user switched away during the async create.
  useReposStore.getState().addAndFocusWorkspacePaneTerminalTab(input.base.repoRoot, key, input.base.branch)
  return key
}
