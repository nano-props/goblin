import { describe, expect, test, vi } from 'vitest'
import { WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS } from '#/shared/workspace-pane-runtime.ts'
import type { ClientAppRealtime } from '#/web/app-realtime-client.ts'
import { createServerWorkspacePaneRuntimeClient } from '#/web/client-workspace-pane-runtime.ts'

const target = {
  repoRoot: '/repo',
  repoRuntimeId: 'repo-runtime-test',
  branchName: 'main',
  worktreePath: '/repo/worktree',
}

describe('createServerWorkspacePaneRuntimeClient', () => {
  test('routes close and close-worktree through their namespaced realtime actions', async () => {
    const request = vi.fn(async (action: string) => ({
      ok: true as const,
      runtimeType: 'terminal' as const,
      workspacePaneTabs: { revision: action === WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close ? 2 : 3, entries: [] },
    }))
    const client = createServerWorkspacePaneRuntimeClient(realtimeWithRequest(request))
    const closeInput = {
      runtimeType: 'terminal' as const,
      sessionId: 'term-111111111111111111111',
      target,
    }
    const closeWorktreeInput = { runtimeType: 'terminal' as const, target }

    await expect(client.close(closeInput)).resolves.toMatchObject({
      ok: true,
      runtimeType: 'terminal',
      workspacePaneTabs: { revision: 2, entries: [] },
    })
    await expect(client.closeWorktree(closeWorktreeInput)).resolves.toMatchObject({
      ok: true,
      runtimeType: 'terminal',
      workspacePaneTabs: { revision: 3, entries: [] },
    })
    expect(request).toHaveBeenNthCalledWith(1, WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close, closeInput)
    expect(request).toHaveBeenNthCalledWith(2, WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.closeWorktree, closeWorktreeInput)
  })

  test('rejects malformed canonical snapshots returned by runtime close', async () => {
    const client = createServerWorkspacePaneRuntimeClient(
      realtimeWithRequest(
        vi.fn(async () => ({
          ok: true,
          runtimeType: 'terminal',
          workspacePaneTabs: { revision: -1, entries: [] },
        })),
      ),
    )

    await expect(
      client.close({ runtimeType: 'terminal', sessionId: 'term-111111111111111111111', target }),
    ).rejects.toThrow('invalid close response')
  })
})

function realtimeWithRequest(request: (...args: any[]) => Promise<any>): ClientAppRealtime {
  return {
    request,
    kickReconnect: () => {},
    onMessage: () => () => {},
    onRecovered: () => () => {},
  } as ClientAppRealtime
}
