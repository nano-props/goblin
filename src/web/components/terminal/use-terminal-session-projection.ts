import { useState } from 'react'
import {
  getTerminalSessionProjection,
  type TerminalSessionProjection,
} from '#/web/components/terminal/TerminalSessionProjection.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'

export function useTerminalSessionProjection(): TerminalSessionProjection {
  const setSelectedTerminal = useWorkspacesStore((s) => s.setSelectedTerminal)
  const [projection] = useState(() =>
    getTerminalSessionProjection({
      onSelectedFilesystemTargetChange: setSelectedTerminal,
    }),
  )
  return projection
}
