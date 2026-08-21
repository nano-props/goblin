import { describe, expect, test } from 'vitest'
import { normalizeAppRealtimeSocketServerMessage } from '#/shared/app-realtime-validators.ts'
import {
  WORKSPACE_PANE_TABS_REALTIME_EVENTS,
  WORKSPACE_PANE_TABS_SOCKET_ACTIONS,
} from '#/shared/workspace-pane-tabs.ts'

describe('app realtime workspace pane tabs validators', () => {
  test('normalizes workspace pane tabs responses', () => {
    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_workspace_tabs_indeterminate',
        ok: false,
        action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
        error: 'delivery uncertain',
        outcome: 'indeterminate',
      }),
    ).toEqual({
      type: 'response',
      requestId: 'req_workspace_tabs_indeterminate',
      ok: false,
      action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
      error: 'delivery uncertain',
      outcome: 'indeterminate',
    })

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
      outcome: 'indeterminate',
    })
  })

  const crossTransportEntry = {
    target: {
      kind: 'git-worktree' as const,
      workspaceId: 'goblin+ssh://mock-host/repo',
      workspaceRuntimeId: 'repo-runtime-test',
      root: 'goblin+ssh://other-mock-host/repo/worktree',
    },
    tabs: [],
  }

  test.each([
    {
      label: 'read without implying a committed outcome',
      action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
      payload: { revision: 3, entries: [crossTransportEntry] },
      expectedOutcome: null,
    },
    {
      label: 'write as indeterminate',
      action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
      payload: { kind: 'projected', snapshot: { revision: 3, entries: [crossTransportEntry] } },
      expectedOutcome: 'indeterminate' as const,
    },
  ])('rejects a semantically invalid tabs $label', ({ action, payload, expectedOutcome }) => {
    const result = normalizeAppRealtimeSocketServerMessage({
      type: 'response',
      requestId: 'req_workspace_tabs_invalid_target',
      ok: true,
      action,
      payload,
    })
    const expected = {
      type: 'response',
      requestId: 'req_workspace_tabs_invalid_target',
      ok: false,
      action,
      error: 'Invalid realtime socket response payload',
    }

    expect(result).toEqual(expectedOutcome === null ? expected : { ...expected, outcome: expectedOutcome })
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
