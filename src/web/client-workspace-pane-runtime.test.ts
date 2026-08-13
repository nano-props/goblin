import { describe, expect, test, vi } from 'vitest'
import { WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS } from '#/shared/workspace-pane-runtime.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { ClientAppRealtime } from '#/web/app-realtime-client.ts'
import { createServerWorkspacePaneRuntimeClient } from '#/web/client-workspace-pane-runtime.ts'

const target = {
  target: {
    kind: 'git-worktree' as const,
    workspaceId: canonicalWorkspaceLocator('goblin+file:///repo')!,
    workspaceRuntimeId: 'repo-runtime-test',
    root: canonicalWorkspaceLocator('goblin+file:///repo/worktree')!,
  },
}

describe('createServerWorkspacePaneRuntimeClient', () => {
  test('rejects a runtime-open snapshot owned by a different execution target', async () => {
    const terminalSessionId = 'term-111111111111111111111'
    const request = vi.fn(async () => ({
      ok: true as const,
      runtimeType: 'terminal' as const,
      paneTabsSnapshot: {
        revision: 1,
        entries: [
          {
            target: {
              ...target.target,
              root: canonicalWorkspaceLocator('goblin+file:///repo/other-worktree')!,
            },
            tabs: [{ type: 'terminal' as const, runtimeSessionId: terminalSessionId }],
          },
        ],
      },
      runtime: {
        ok: true as const,
        action: 'created' as const,
        presentation: { kind: 'git-worktree' as const },
        terminalSessionId,
        terminalProjectionEffect: { kind: 'delta', revision: 1 },
        terminalRuntimeSessionId: 'pty_1234567890abcdef',
        terminalRuntimeGeneration: 1,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open' as const,
        message: null,
        controller: null,
        canonicalSize: { cols: 80, rows: 24 },
      },
    }))
    const client = createServerWorkspacePaneRuntimeClient(realtimeWithRequest(request))

    await expect(
      client.open({ runtimeType: 'terminal', request: { kind: 'primary', target: target.target } }),
    ).rejects.toThrow('invalid open response')
  })

  test('routes close through its namespaced realtime action', async () => {
    const request = vi.fn(async () => ({
      ok: true as const,
      runtimeType: 'terminal' as const,
      paneTabsSnapshot: { revision: 2, entries: [] },
      runtime: {
        action: 'closed' as const,
        terminalSessionId: 'term-111111111111111111111',
        terminalRuntimeSessionId: 'pty_1234567890abcdef',
        terminalRuntimeGeneration: 1,
      },
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
      paneTabsSnapshot: { revision: 2, entries: [] },
    })
    expect(request).toHaveBeenNthCalledWith(1, WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close, closeInput)
  })

  test.each([{ revision: 2, entries: [] }, null])(
    'rejects a runtime close effect for a different requested session with snapshot %j',
    async (paneTabsSnapshot) => {
      const client = createServerWorkspacePaneRuntimeClient(
        realtimeWithRequest(
          vi.fn(async () => ({
            ok: true,
            runtimeType: 'terminal',
            paneTabsSnapshot,
            runtime: {
              action: 'closed',
              terminalSessionId: 'term-222222222222222222222',
              terminalRuntimeSessionId: 'pty_1234567890abcdef',
              terminalRuntimeGeneration: 1,
            },
          })),
        ),
      )

      await expect(
        client.close({ runtimeType: 'terminal', sessionId: 'term-111111111111111111111', target }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('invalid close response'),
        delivery: 'indeterminate',
      })
    },
  )
})

function realtimeWithRequest(request: (...args: any[]) => Promise<any>): ClientAppRealtime {
  return {
    request,
    kickReconnect: () => {},
    onMessage: () => () => {},
    onRecovered: () => () => {},
  } as ClientAppRealtime
}
