import { vi } from 'vitest'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'

interface TestWorkspacePaneTabsHostOptions {
  snapshot?: WorkspacePaneTabsSnapshot
  repaired?: boolean
}

// Most restore tests only need an inert, inspectable implementation.
export function createTestWorkspacePaneTabsHost(options: TestWorkspacePaneTabsHostOptions = {}) {
  const restoreTabs = vi.fn<ServerWorkspacePaneTabsHost['restoreTabs']>(async () => ({
    kind: 'restored',
    snapshot: options.snapshot ?? { revision: 0, entries: [] },
    repaired: options.repaired ?? false,
  }))
  return {
    restoreTabs,
    listWorkspaceTabs: vi.fn(),
    updateTabs: vi.fn(),
  } satisfies ServerWorkspacePaneTabsHost
}
