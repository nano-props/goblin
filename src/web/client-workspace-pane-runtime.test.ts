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
  test('routes close through its namespaced realtime action', async () => {
    const request = vi.fn(async () => ({
      ok: true as const,
      runtimeType: 'terminal' as const,
      runtime: {
        action: 'closed' as const,
        terminalSessionId: 'term-111111111111111111111',
        terminalRuntimeSessionId: 'pty_1234567890abcdef',
        terminalRuntimeGeneration: 1,
      },
      workspacePaneTabs: { revision: 2, entries: [] },
    }))
    const client = createServerWorkspacePaneRuntimeClient(realtimeWithRequest(request))
    const closeInput = {
      runtimeType: 'terminal' as const,
      sessionId: 'term-111111111111111111111',
      target,
    }
    await expect(client.close(closeInput)).resolves.toMatchObject({
      ok: true,
      runtimeType: 'terminal',
      runtime: {
        action: 'closed',
        terminalSessionId: 'term-111111111111111111111',
        terminalRuntimeSessionId: 'pty_1234567890abcdef',
        terminalRuntimeGeneration: 1,
      },
      workspacePaneTabs: { revision: 2, entries: [] },
    })
    expect(request).toHaveBeenNthCalledWith(1, WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close, closeInput)
  })

  test('rejects malformed canonical snapshots returned by runtime close', async () => {
    const client = createServerWorkspacePaneRuntimeClient(
      realtimeWithRequest(
        vi.fn(async () => ({
          ok: true,
          runtimeType: 'terminal',
          runtime: {
            action: 'closed',
            terminalSessionId: 'term-111111111111111111111',
            terminalRuntimeSessionId: 'pty_1234567890abcdef',
            terminalRuntimeGeneration: 1,
          },
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
