import { useReposStore } from '#/web/stores/repos/store.ts'
import type { TerminalSlotBase } from '#/web/components/terminal/types.ts'

export async function createWorkspacePaneTerminalTab(input: {
  base: TerminalSlotBase
  createTerminal: (base: TerminalSlotBase) => Promise<string>
}): Promise<string> {
  // Only publish the tab after the registry has created a concrete session key.
  const key = await input.createTerminal(input.base)
  useReposStore.getState().addWorkspacePaneTerminalTab(input.base.repoRoot, key, input.base.branch)
  return key
}
