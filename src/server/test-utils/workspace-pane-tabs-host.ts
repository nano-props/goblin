import { vi } from 'vitest'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'

// The production host has four methods; most restore tests only need an inert, inspectable implementation.
export function createTestWorkspacePaneTabsHost() {
  const restoreTabs = vi.fn<ServerWorkspacePaneTabsHost['restoreTabs']>(async () => ({
    kind: 'restored',
    snapshot: { revision: 0, entries: [] },
    repaired: false,
  }))
  return {
    restoreTabs,
    listWorkspaceTabs: vi.fn(),
    replaceTabs: vi.fn(),
    updateTabs: vi.fn(),
  } satisfies ServerWorkspacePaneTabsHost
}
