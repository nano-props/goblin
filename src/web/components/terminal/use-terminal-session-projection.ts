import { getTerminalSessionProjection } from '#/web/components/terminal/TerminalSessionProjection.ts'
import type { TerminalSessionProjection } from '#/web/components/terminal/TerminalSessionProjection.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'

export function useTerminalSessionProjection(): TerminalSessionProjection {
  return getTerminalSessionProjection({
    onSelectedFilesystemTargetChange: (terminalFilesystemTargetKey, terminalSessionId) => {
      workspacesStore.getState().setSelectedTerminal(terminalFilesystemTargetKey, terminalSessionId)
    },
  })
}
