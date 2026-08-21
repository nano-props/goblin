// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import '#/web/test-utils/terminal-session-projection.ts'
import { TerminalSessionProjection } from '#/web/terminal/components/TerminalSessionProjection.ts'
import {
  requiredTerminalSession,
  terminalSessionProjectionAccess,
} from '#/web/test-utils/terminal-session-projection-access.ts'
import {
  REPO_ROOT,
  WORKSPACE_RUNTIME_ID,
  WORKTREE_KEY,
  makeRuntimeMembershipIndex,
  makeServerSession,
  sessionClosedEvent,
} from '#/web/test-utils/terminal-session-projection.ts'

const terminalSessionId = 'term-111111111111111111111'
const lineageA = 'pty_lineage_a_aaaaaaaa'
const lineageB = 'pty_lineage_b_aaaaaaaa'

function projectionWithRestartingSession() {
  const projection = new TerminalSessionProjection()
  projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
  projection.reconcileServerSessions(
    { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
    [
      makeServerSession('pty_generation_race_aaaa', terminalSessionId, {
        terminalRuntimeGeneration: 1,
      }),
    ],
    'client_local',
  )
  requiredTerminalSession(projection, terminalSessionId).restart()
  return projection
}

describe('TerminalSessionProjection races', () => {
  test('does not delete a durable session when the retiring generation exits during restart', () => {
    const projection = projectionWithRestartingSession()
    try {
      projection.handleExit({
        terminalRuntimeSessionId: 'pty_generation_race_aaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId,
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        tabsBeforeRetirement: null,
      })

      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
    } finally {
      projection.destroy()
    }
  })

  test('does not delete a durable session when its retiring runtime closes during restart', () => {
    const projection = projectionWithRestartingSession()
    try {
      projection.handleSessionClosed(sessionClosedEvent('pty_generation_race_aaaa', 1, terminalSessionId))

      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
    } finally {
      projection.destroy()
    }
  })

  test('does not apply or retain a bell from the retiring runtime during restart', () => {
    const projection = projectionWithRestartingSession()
    try {
      projection.handleServerBell({
        terminalRuntimeSessionId: 'pty_generation_race_aaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId,
        workspaceId: REPO_ROOT,
        processName: 'zsh',
        canonicalTitle: null,
      })

      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).bellCount).toBe(0)
    } finally {
      projection.destroy()
    }
  })

  test('drops a bell that arrives before its runtime binding is known', () => {
    const localProjection = new TerminalSessionProjection()
    localProjection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    localProjection.handleServerBell({
      terminalRuntimeSessionId: 'pty_future_bell_aaaaaaaa',
      terminalRuntimeGeneration: 2,
      terminalSessionId: 'term-111111111111111111111',
      workspaceId: REPO_ROOT,
      processName: 'zsh',
      canonicalTitle: null,
    })

    localProjection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [
        makeServerSession('pty_future_bell_aaaaaaaa', 'term-111111111111111111111', {
          terminalRuntimeGeneration: 2,
        }),
      ],
      'client_local',
    )

    expect(localProjection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).bellCount).toBe(0)
    localProjection.destroy()
  })

  test('ignores older and foreign partial effects for a newer active binding', () => {
    const projection = new TerminalSessionProjection()
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession(lineageA, terminalSessionId, { terminalRuntimeGeneration: 2 })],
      'client_local',
    )

    terminalSessionProjectionAccess(projection).applyServerSessionEffect(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      { kind: 'delta', revision: 1 },
      makeServerSession(lineageA, terminalSessionId, { terminalRuntimeGeneration: 1 }),
      'client_local',
    )
    terminalSessionProjectionAccess(projection).applyServerSessionEffect(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      { kind: 'delta', revision: 1 },
      makeServerSession(lineageB, terminalSessionId, { terminalRuntimeGeneration: 0 }),
      'client_local',
    )

    const session = requiredTerminalSession(projection, terminalSessionId)
    expect(session.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: lineageA,
      terminalRuntimeGeneration: 2,
    })
    projection.destroy()
  })
})
