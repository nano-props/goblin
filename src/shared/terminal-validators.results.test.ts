import { describe, expect, test } from 'vitest'
import {
  normalizeTerminalCreateResult,
  normalizeTerminalRealtimeMessage,
  normalizeTerminalSessionsSnapshot,
  normalizeTerminalSocketServerMessage,
} from '#/shared/terminal-validators.ts'
import {
  WORKSPACE_PANE_TABS_REALTIME_EVENTS,
  WORKSPACE_PANE_TABS_SOCKET_ACTIONS,
} from '#/shared/workspace-pane-tabs.ts'
import { normalizeAppRealtimeSocketServerMessage } from '#/shared/app-realtime-validators.ts'
import { WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS } from '#/shared/workspace-pane-runtime.ts'

describe('shared terminal validators results', () => {
  test('normalizes terminal create results with required prepared-session metadata', () => {
    const createResult = {
      ok: true,
      action: 'created' as const,
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'main' } },
      terminalSessionId: 'term-111111111111111111111',
      terminalProjectionEffect: { kind: 'delta', revision: 11 },
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
      identityRevision: 0,
      processName: '',
      canonicalTitle: null,
      phase: 'opening',
      message: null,
      controller: null,
      canonicalSize: null,
    }
    const normalizedCreateResult = normalizeTerminalCreateResult(createResult)
    expect(normalizedCreateResult).not.toHaveProperty('sessions')
    expect(normalizedCreateResult).toMatchObject({
      ok: true,
      terminalSessionId: 'term-111111111111111111111',
      terminalProjectionEffect: { kind: 'delta', revision: 11 },
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
    })
    expect(normalizedCreateResult).not.toHaveProperty('tabs')
    expect(normalizeTerminalCreateResult({ ...createResult, identityRevision: 1 })).toBeNull()
    expect(normalizeTerminalCreateResult({ ...createResult, identityRevision: undefined })).toBeNull()

    expect(
      normalizeTerminalCreateResult({
        ok: true,
        action: 'created',
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'main' } },
        terminalSessionId: 'term-111111111111111111111',
        terminalProjectionEffect: { kind: 'delta', revision: 11 },
      }),
    ).toBeNull()
    expect(normalizeTerminalCreateResult({ ok: false, message: 'error.spawn-failed' })).toEqual({
      ok: false,
      message: 'error.spawn-failed',
    })
  })

  test('rejects terminal presentations without a canonical target-compatible branch', () => {
    const metadata = {
      ok: true,
      action: 'created',
      terminalSessionId: 'term-111111111111111111111',
      terminalProjectionEffect: { kind: 'delta', revision: 11 },
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
      identityRevision: 0,
      processName: '',
      canonicalTitle: null,
      phase: 'opening',
      message: null,
      controller: null,
      canonicalSize: null,
    }
    expect(
      normalizeTerminalCreateResult({
        ...metadata,
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: '' } },
      }),
    ).toBeNull()
    expect(
      normalizeTerminalCreateResult({
        ...metadata,
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: '   ' } },
      }),
    ).toBeNull()
    expect(
      normalizeTerminalCreateResult({
        ...metadata,
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'bad\0branch' } },
      }),
    ).toBeNull()
    expect(
      normalizeTerminalCreateResult({
        ...metadata,
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'main' } },
        branch: 'legacy-main',
      }),
    ).toBeNull()
  })

  test('rejects terminal session snapshots with non-execution or presentation-mismatched targets', () => {
    const session = {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 0,
      terminalSessionId: 'term-111111111111111111111',
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'main' } },
      controller: null,
      processName: 'zsh',
      canonicalTitle: null,
      phase: 'open',
      message: null,
      canonicalSize: { cols: 120, rows: 40 },
      target: {
        kind: 'git-worktree',
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-test',
        root: 'goblin+file:///repo/worktree',
      },
    }
    expect(normalizeTerminalSessionsSnapshot({ revision: 1, sessions: [session] })).not.toBeNull()
    expect(
      normalizeTerminalSessionsSnapshot({
        revision: 1,
        sessions: [
          {
            ...session,
            target: {
              kind: 'workspace-root',
              workspaceId: 'goblin+file:///repo',
              workspaceRuntimeId: 'repo-runtime-test',
            },
          },
        ],
      }),
    ).toBeNull()
    expect(
      normalizeTerminalSessionsSnapshot({
        revision: 1,
        sessions: [
          {
            ...session,
            target: {
              kind: 'git-branch',
              workspaceId: 'goblin+file:///repo',
              workspaceRuntimeId: 'repo-runtime-test',
              branch: 'main',
            },
          },
        ],
      }),
    ).toBeNull()
    expect(normalizeTerminalSessionsSnapshot({ revision: 1, sessions: [{ ...session, branch: 'legacy' }] })).toBeNull()

    for (const invalidSession of [
      {
        ...session,
        target: {
          kind: 'workspace-root' as const,
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'repo-runtime-test',
        },
      },
      {
        ...session,
        target: { ...session.target, root: 'goblin+file:///repo/%77orktree' },
      },
      {
        ...session,
        target: { ...session.target, root: 'goblin+file:///C:/repo/worktree' },
      },
    ]) {
      expect(
        normalizeTerminalSocketServerMessage({
          type: 'response',
          requestId: 'req-recover',
          ok: true,
          action: 'recover-sessions',
          payload: { revision: 1, sessions: [invalidSession] },
        }),
      ).toMatchObject({
        type: 'response',
        requestId: 'req-recover',
        ok: false,
        action: 'recover-sessions',
        error: 'Invalid terminal socket response payload',
      })
    }
  })

  test('normalizes valid terminal socket server messages', () => {
    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'output',
        event: {
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 1,
          terminalSessionId: 'term-111111111111111111111',
          data: 'hi',
          seq: 1,
          processName: 'zsh',
        },
      }),
    ).toEqual({
      type: 'output',
      event: {
        terminalRuntimeSessionId: 'pty_1234567890abcdef',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'hi',
        seq: 1,
        processName: 'zsh',
      },
    })

    expect(normalizeAppRealtimeSocketServerMessage({ type: 'pong', requestId: 'health_1' })).toEqual({
      type: 'pong',
      requestId: 'health_1',
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_1',
        ok: false,
        action: 'attach',
      }),
    ).toBeNull()

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_workspace_tabs',
        ok: true,
        action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
        payload: { revision: 3, entries: [] },
      }),
    ).toMatchObject({
      type: 'response',
      requestId: 'req_workspace_tabs',
      ok: true,
      action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
      payload: { revision: 3, entries: [] },
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_workspace_tabs_invalid_revision',
        ok: true,
        action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
        payload: { revision: -1, entries: [] },
      }),
    ).toMatchObject({
      ok: false,
      action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
      error: 'Invalid realtime socket response payload',
    })
  })

  test('normalizes runtime-open command responses', () => {
    const payload = {
      ok: true,
      runtimeType: 'terminal',
      paneTabsSnapshot: {
        revision: 7,
        entries: [
          {
            target: {
              kind: 'git-worktree',
              workspaceId: 'goblin+file:///repo',
              workspaceRuntimeId: 'repo-runtime-test',
              root: 'goblin+file:///repo/worktree',
            },
            tabs: [{ type: 'terminal', runtimeSessionId: 'term-111111111111111111111' }],
          },
        ],
      },
      runtime: {
        ok: true,
        action: 'created',
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'main' } },
        terminalSessionId: 'term-111111111111111111111',
        terminalProjectionEffect: { kind: 'delta', revision: 11 },
        terminalRuntimeSessionId: 'pty_1234567890abcdef',
        terminalRuntimeGeneration: 0,
        identityRevision: 0,
        processName: '',
        canonicalTitle: null,
        phase: 'opening',
        message: null,
        controller: null,
        canonicalSize: null,
      },
    }

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'request_runtime_open',
        ok: true,
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
        payload,
      }),
    ).toMatchObject({
      type: 'response',
      ok: true,
      action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
      payload,
    })
    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'request_runtime_open_missing_owner',
        ok: true,
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
        payload: { ...payload, paneTabsSnapshot: { revision: 7, entries: [] } },
      }),
    ).toMatchObject({ ok: false, action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open })
    const workspaceOwner = {
      target: {
        kind: 'workspace-root' as const,
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-test',
      },
      tabs: [{ type: 'terminal' as const, runtimeSessionId: 'term-111111111111111111111' }],
    }
    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'request_runtime_open_cross_kind_owner',
        ok: true,
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
        payload: { ...payload, paneTabsSnapshot: { revision: 7, entries: [workspaceOwner] } },
      }),
    ).toMatchObject({ ok: false, action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open })
    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'request_runtime_open_duplicate_owner',
        ok: true,
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
        payload: {
          ...payload,
          paneTabsSnapshot: {
            revision: 7,
            entries: [...payload.paneTabsSnapshot.entries, workspaceOwner],
          },
        },
      }),
    ).toMatchObject({ ok: false, action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open })
    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'request_runtime_open_invalid',
        ok: true,
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
        payload: { ...payload, runtime: { ...payload.runtime, processName: undefined } },
      }),
    ).toMatchObject({
      ok: false,
      action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
      error: 'Invalid realtime socket response payload',
    })
  })

  test('normalizes runtime close command responses', () => {
    const paneTabsSnapshot = { revision: 8, entries: [] }
    const effects = [
      {
        action: 'closed' as const,
        terminalSessionId: 'term-111111111111111111111',
        terminalRuntimeSessionId: 'pty_1234567890abcdef',
        terminalRuntimeGeneration: 1,
      },
      {
        action: 'already-closed' as const,
        terminalSessionId: 'term-222222222222222222222',
      },
    ]
    for (const [index, runtime] of effects.entries()) {
      expect(
        normalizeAppRealtimeSocketServerMessage({
          type: 'response',
          requestId: `request_runtime_close_${index}`,
          ok: true,
          action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
          payload: { ok: true, runtimeType: 'terminal', runtime, paneTabsSnapshot },
        }),
      ).toMatchObject({
        type: 'response',
        ok: true,
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
        payload: { ok: true, runtimeType: 'terminal', runtime, paneTabsSnapshot },
      })
      expect(
        normalizeAppRealtimeSocketServerMessage({
          type: 'response',
          requestId: `request_runtime_close_invalid_${index}`,
          ok: true,
          action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
          payload: {
            ok: true,
            runtimeType: 'terminal',
            runtime: { ...runtime, action: 'invalid' },
            paneTabsSnapshot,
          },
        }),
      ).toMatchObject({
        ok: false,
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
        error: 'Invalid realtime socket response payload',
      })
    }

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'request_runtime_close_still_owned',
        ok: true,
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
        payload: {
          ok: true,
          runtimeType: 'terminal',
          runtime: effects[0],
          paneTabsSnapshot: {
            revision: 9,
            entries: [
              {
                target: {
                  kind: 'git-worktree',
                  workspaceId: 'goblin+file:///repo',
                  workspaceRuntimeId: 'repo-runtime-test',
                  root: 'goblin+file:///repo/worktree',
                },
                tabs: [{ type: 'terminal', runtimeSessionId: effects[0].terminalSessionId }],
              },
            ],
          },
        },
      }),
    ).toMatchObject({
      ok: false,
      action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
      error: 'Invalid realtime socket response payload',
    })
  })

  test('validates terminal socket success response payloads by action', () => {
    const resizeResponse = {
      type: 'response',
      requestId: 'req_resize',
      ok: true,
      action: 'resize',
      payload: {
        ok: true,
        terminalRuntimeSessionId: 'pty_1234567890abcdef',
        terminalRuntimeGeneration: 3,
        identityRevision: 1,
        role: 'controller',
        controllerStatus: 'connected',
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalSize: { cols: 120, rows: 40 },
      },
    } as const
    expect(normalizeAppRealtimeSocketServerMessage(resizeResponse)).toEqual(resizeResponse)
    for (const payload of [
      true,
      { ...resizeResponse.payload, terminalRuntimeGeneration: 0 },
      { ...resizeResponse.payload, canonicalSize: null },
      ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1].map((identityRevision) => ({
        ...resizeResponse.payload,
        identityRevision,
      })),
    ]) {
      expect(normalizeAppRealtimeSocketServerMessage({ ...resizeResponse, payload })).toMatchObject({
        ok: false,
        action: 'resize',
        error: 'Invalid terminal socket response payload',
      })
    }

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_takeover',
        ok: true,
        action: 'takeover',
        payload: {
          ok: true,
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 3,
          identityRevision: 1,
          role: 'controller',
          controllerStatus: 'connected',
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
          phase: 'open',
        },
      }),
    ).toMatchObject({
      type: 'response',
      action: 'takeover',
      payload: { ok: true, terminalRuntimeGeneration: 3 },
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_takeover_unbound',
        ok: true,
        action: 'takeover',
        payload: {
          ok: true,
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 0,
          identityRevision: 0,
          role: 'controller',
          controllerStatus: 'connected',
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
          phase: 'open',
        },
      }),
    ).toMatchObject({ ok: false, error: 'Invalid terminal socket response payload' })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_takeover_missing_generation',
        ok: true,
        action: 'takeover',
        payload: {
          ok: true,
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          identityRevision: 1,
          role: 'controller',
          controllerStatus: 'connected',
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
          phase: 'open',
        },
      }),
    ).toMatchObject({
      ok: false,
      action: 'takeover',
      error: 'Invalid terminal socket response payload',
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_1',
        ok: true,
        action: 'attach',
        payload: {
          ok: true,
          frame: 'snapshot',
          terminalProjectionEffect: { kind: 'none' },
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 1,
          identityRevision: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          snapshot: 'prompt',
          snapshotSeq: 1,
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        },
      }),
    ).toMatchObject({
      type: 'response',
      action: 'attach',
      payload: { ok: true, frame: 'snapshot' },
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_stream_attach',
        ok: true,
        action: 'attach',
        payload: {
          ok: true,
          frame: 'stream',
          terminalProjectionEffect: { kind: 'delta', revision: 2 },
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 1,
          identityRevision: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        },
      }),
    ).toMatchObject({
      type: 'response',
      action: 'attach',
      payload: { ok: true, frame: 'stream' },
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_unready_stream_attach',
        ok: true,
        action: 'attach',
        payload: {
          ok: true,
          frame: 'stream',
          terminalProjectionEffect: { kind: 'delta', revision: 2 },
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 1,
          identityRevision: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'opening',
          message: null,
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        },
      }),
    ).toMatchObject({
      type: 'response',
      requestId: 'req_unready_stream_attach',
      ok: false,
      action: 'attach',
      error: 'Invalid terminal socket response payload',
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_invalid_stream_restart',
        ok: true,
        action: 'restart',
        payload: {
          ok: true,
          frame: 'stream',
          terminalProjectionEffect: { kind: 'delta', revision: 2 },
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 2,
          identityRevision: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'opening',
          message: null,
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        },
      }),
    ).toMatchObject({
      type: 'response',
      requestId: 'req_invalid_stream_restart',
      ok: false,
      action: 'restart',
      error: 'Invalid terminal socket response payload',
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_1',
        ok: true,
        action: 'attach',
        payload: {
          ok: true,
          frame: 'snapshot',
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 1,
          identityRevision: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          snapshot: 'prompt',
          snapshotSeq: 1,
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        },
      }),
    ).toMatchObject({
      type: 'response',
      requestId: 'req_1',
      ok: false,
      action: 'attach',
      error: 'Invalid terminal socket response payload',
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_1',
        ok: true,
        action: 'create',
        payload: {},
      }),
    ).toBeNull()
  })

  test('normalizes targeted session-closed realtime messages', () => {
    expect(
      normalizeTerminalSocketServerMessage({
        type: 'session-closed',
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-test',
        tabsBeforeRetirement: null,
      }),
    ).toEqual({
      type: 'session-closed',
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      workspaceId: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test',
      tabsBeforeRetirement: null,
    })
    expect(
      normalizeTerminalSocketServerMessage({
        type: 'session-closed',
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        workspaceId: 'goblin+file:///repo',
        worktreePath: '/repo/worktree',
      }),
    ).toBeNull()
  })

  test('rejects malformed terminal retirement tab snapshots', () => {
    const tabsBeforeRetirement = [{ type: 'terminal' }]
    expect(
      normalizeTerminalRealtimeMessage({
        type: 'exit',
        event: {
          terminalRuntimeSessionId: 'pty_retirement_mismatch',
          terminalRuntimeGeneration: 1,
          terminalSessionId: 'term-retirement-mismatch',
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'repo-runtime-test',
          tabsBeforeRetirement,
        },
      }),
    ).toBeNull()
    expect(
      normalizeTerminalRealtimeMessage({
        type: 'session-closed',
        terminalRuntimeSessionId: 'pty_retirement_mismatch',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-retirement-mismatch',
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-test',
        tabsBeforeRetirement,
      }),
    ).toBeNull()
  })

  test('rejects projection effects that contradict terminal frame ownership', () => {
    const metadata = {
      terminalRuntimeSessionId: 'pty_1234567890abcdef',
      terminalRuntimeGeneration: 1,
      identityRevision: 0,
      processName: 'zsh',
      canonicalTitle: null,
      phase: 'open',
      message: null,
      controller: { clientId: 'client_a', status: 'connected' },
      canonicalSize: { cols: 120, rows: 40 },
    }
    const invalidResponses = [
      {
        action: 'attach',
        payload: {
          ok: true,
          frame: 'stream',
          terminalProjectionEffect: { kind: 'none' },
          ...metadata,
        },
      },
      {
        action: 'attach',
        payload: {
          ok: true,
          frame: 'snapshot',
          terminalProjectionEffect: { kind: 'delta', revision: 2 },
          snapshot: '',
          snapshotSeq: 0,
          ...metadata,
        },
      },
      {
        action: 'restart',
        payload: {
          ok: true,
          frame: 'snapshot',
          terminalProjectionEffect: { kind: 'none' },
          snapshot: '',
          snapshotSeq: 0,
          ...metadata,
        },
      },
    ]

    for (const [index, response] of invalidResponses.entries()) {
      expect(
        normalizeAppRealtimeSocketServerMessage({
          type: 'response',
          requestId: `invalid_effect_${index}`,
          ok: true,
          ...response,
        }),
      ).toMatchObject({
        type: 'response',
        requestId: `invalid_effect_${index}`,
        ok: false,
        error: 'Invalid terminal socket response payload',
      })
    }
  })

  test('rejects invalid snapshot sequence checkpoints', () => {
    const payload = {
      ok: true,
      frame: 'snapshot',
      terminalProjectionEffect: { kind: 'none' },
      terminalRuntimeSessionId: 'pty_1234567890abcdef',
      terminalRuntimeGeneration: 1,
      identityRevision: 0,
      processName: 'zsh',
      canonicalTitle: null,
      phase: 'open',
      message: null,
      snapshot: 'prompt',
      snapshotSeq: 1,
      controller: { clientId: 'client_a', status: 'connected' },
      canonicalSize: { cols: 120, rows: 40 },
    } as const

    for (const field of ['snapshotSeq'] as const) {
      for (const [index, value] of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1].entries()) {
        expect(
          normalizeAppRealtimeSocketServerMessage({
            type: 'response',
            requestId: `invalid_${field}_${index}`,
            ok: true,
            action: 'attach',
            payload: { ...payload, [field]: value },
          }),
        ).toMatchObject({
          ok: false,
          action: 'attach',
          error: 'Invalid terminal socket response payload',
        })
      }
    }
  })

  test('normalizes workspace tabs changed realtime messages', () => {
    const messages = [
      {
        type: WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed,
        change: 'invalidation' as const,
        workspaceId: 'goblin+file:///repo',
      },
      {
        type: WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed,
        change: 'revision' as const,
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-test',
        revision: 4,
      },
    ]
    for (const message of messages) {
      expect(normalizeAppRealtimeSocketServerMessage(message)).toEqual(message)
      expect(normalizeAppRealtimeSocketServerMessage({ ...message, repoRoot: message.workspaceId })).toBeNull()
      const { workspaceId, ...legacyMessage } = message
      expect(normalizeAppRealtimeSocketServerMessage({ ...legacyMessage, repoRoot: workspaceId })).toBeNull()
    }

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'workspace-tabs-changed',
        workspaceId: 'goblin+file:///repo',
      }),
    ).toBeNull()
  })
})
