import { useReposStore } from '#/web/stores/repos/store.ts'
import { preferredWorkspacePaneTabForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import type { TerminalCreateOptions } from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { runWorkspacePaneTabUiCommand } from '#/web/workspace-pane/workspace-pane-tab-command-queue.ts'

export async function createWorkspacePaneTerminalTab(input: {
  base: TerminalSessionBase
  createTerminal: (base: TerminalSessionBase, options?: TerminalCreateOptions) => Promise<string>
  options?: TerminalCreateOptions
}): Promise<string> {
  // Only publish the tab after the projection has created a concrete session key.
  const key = input.options ? await input.createTerminal(input.base, input.options) : await input.createTerminal(input.base)
  await runWorkspacePaneTabUiCommand(() => commitCreatedWorkspacePaneTerminalTab(input.base, key))
  return key
}

function commitCreatedWorkspacePaneTerminalTab(base: TerminalSessionBase, key: string): void {
  const state = useReposStore.getState()
  const repo = state.repos[base.repoRoot]
  const shouldFocus =
    repo?.ui.selectedBranch === base.branch && preferredWorkspacePaneTabForBranch(repo.ui, base.branch) === 'terminal'
  if (shouldFocus) {
    state.addAndFocusWorkspacePaneTerminalTab(base.repoRoot, key, base.branch)
    return
  }
  state.addWorkspacePaneTerminalTab(base.repoRoot, key, base.branch)
}
