import { queryOptions } from '@tanstack/react-query'
import type { TerminalSessionSummary } from '#/shared/terminal.ts'
import { terminalBridge } from '#/web/terminal.ts'

export function terminalSessionsQueryKey(repoRoot: string) {
  return ['terminal-sessions', repoRoot] as const
}

export function terminalSessionsQueryOptions(repoRoot: string) {
  return queryOptions<TerminalSessionSummary[]>({
    queryKey: terminalSessionsQueryKey(repoRoot),
    queryFn: () => terminalBridge.listSessions({ repoRoot }),
    staleTime: 0,
    gcTime: 5 * 60_000,
  })
}
