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
  // Only publish the tab after the projection has created a concrete terminalKey.
  const terminalKey = input.options
    ? await input.createTerminal(input.base, input.options)
    : await input.createTerminal(input.base)
  await runWorkspacePaneTabUiCommand(() => commitCreatedWorkspacePaneTerminalTab(input.base, terminalKey))
  return terminalKey
}

function commitCreatedWorkspacePaneTerminalTab(base: TerminalSessionBase, terminalKey: string): void {
  const state = useReposStore.getState()
  const repo = state.repos[base.repoRoot]
  const shouldFocus =
    repo?.ui.selectedBranch === base.branch && preferredWorkspacePaneTabForBranch(repo.ui, base.branch) === 'terminal'
  if (shouldFocus) {
    state.ensureAndFocusWorkspacePaneTerminalTab(base.repoRoot, terminalKey, base.branch)
    return
  }
  state.ensureWorkspacePaneTerminalTab(base.repoRoot, terminalKey, base.branch)
}
