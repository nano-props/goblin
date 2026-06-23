import type { TerminalSlotSummary } from '#/shared/terminal-types.ts'
import { terminalBridge } from '#/web/terminal.ts'

// Plain async loader for a repo's terminal session list. The
// TerminalSessionRegistry is the single source of truth for session
// state; this loader is only used by the provider to refetch the
// list when a `sessions-changed` realtime event arrives. It used
// to be wrapped in a TanStack Query `queryOptions` (the only
// remaining call site), but the wrapper added no caching, dedup,
// or refetch control that the provider needed — the provider
// already drives the refetch lifecycle on its own. Keeping the
// loader as a plain async function means there is no second
// client-side state surface to keep in sync with the registry.
export async function loadTerminalSessions(repoRoot: string): Promise<TerminalSlotSummary[]> {
  return await terminalBridge.listSessions({ repoRoot })
}
