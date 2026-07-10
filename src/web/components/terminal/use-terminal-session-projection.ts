import { useState } from 'react'
import {
  getTerminalSessionProjection,
  type TerminalSessionProjection,
} from '#/web/components/terminal/TerminalSessionProjection.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

export function useTerminalSessionProjection(): TerminalSessionProjection {
  const setSelectedTerminal = useReposStore((s) => s.setSelectedTerminal)
  const [projection] = useState(() =>
    getTerminalSessionProjection({
      onSelectedWorktreeChange: setSelectedTerminal,
    }),
  )
  return projection
}
