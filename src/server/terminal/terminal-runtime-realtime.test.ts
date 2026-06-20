import { describe, expect, test, vi } from 'vitest'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'
import { createTerminalRealtimeHandlers } from '#/server/terminal/terminal-runtime-realtime.ts'

function makeHost(overrides: Partial<ServerTerminalHost>): ServerTerminalHost {
  return {
    isValidClientId: ((value: unknown): value is string => typeof value === 'string') as never,
    getDiagnostics: vi.fn(() => ({}) as never),
    registerSocket: vi.fn(),
    unregisterSocket: vi.fn(),
    attach: vi.fn(),
    restart: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    takeover: vi.fn(),
    close: vi.fn(),
    listSessions: vi.fn(),
    listViews: vi.fn(async () => []),
    openView: vi.fn(async () => true),
    closeView: vi.fn(async () => true),
    create: vi.fn(),
    prune: vi.fn(),
    getSessionSnapshot: vi.fn(),
    reorderViews: vi.fn(async () => true),
    handleRealtimeMessage: vi.fn(),
    shutdown: vi.fn(),
    ...overrides,
  }
}

describe('createTerminalRealtimeHandlers', () => {
  test('routes workspace pane actions through workspace pane host methods', async () => {
    const host = makeHost({})
    const handlers = createTerminalRealtimeHandlers(host)

    await expect(
      handlers['workspace-pane:list-views']('client_1', 'attachment_1', 'owner_1', { repoRoot: '/repo' }),
    ).resolves.toEqual([])
    await expect(
      handlers['workspace-pane:open-view']('client_1', 'attachment_1', 'owner_1', {
        repoRoot: '/repo',
        worktreePath: '/repo',
        type: 'status',
      }),
    ).resolves.toBe(true)
    await expect(
      handlers['workspace-pane:close-view']('client_1', 'attachment_1', 'owner_1', {
        repoRoot: '/repo',
        worktreePath: '/repo',
        type: 'status',
      }),
    ).resolves.toBe(true)
    await expect(
      handlers['workspace-pane:reorder-views']('client_1', 'attachment_1', 'owner_1', {
        repoRoot: '/repo',
        worktreePath: '/repo',
        orderedViews: [{ type: 'status', id: 'status' }],
      }),
    ).resolves.toBe(true)

    expect(host.listViews).toHaveBeenCalledWith('client_1', 'owner_1', '/repo')
    expect(host.openView).toHaveBeenCalledWith('client_1', 'owner_1', {
      repoRoot: '/repo',
      worktreePath: '/repo',
      type: 'status',
    })
    expect(host.closeView).toHaveBeenCalledWith('client_1', 'owner_1', {
      repoRoot: '/repo',
      worktreePath: '/repo',
      type: 'status',
    })
    expect(host.reorderViews).toHaveBeenCalledWith('client_1', 'owner_1', {
      repoRoot: '/repo',
      worktreePath: '/repo',
      orderedViews: [{ type: 'status', id: 'status' }],
    })
  })
})
