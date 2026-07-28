// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import '#/web/test-utils/terminal-session-projection.ts'
import { TerminalSessionProjection } from '#/web/components/terminal/TerminalSessionProjection.ts'
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

describe('TerminalSessionProjection races', () => {
  test('does not delete a durable session when the retiring generation exits during restart', () => {
    const localProjection = new TerminalSessionProjection()
    localProjection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    localProjection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [
        makeServerSession('pty_generation_race_aaaa', 'term-111111111111111111111', {
          terminalRuntimeGeneration: 1,
        }),
      ],
      'client_local',
    )
    const session = requiredTerminalSession(localProjection, 'term-111111111111111111111')
    session.restart()

    localProjection.handleExit({
      terminalRuntimeSessionId: 'pty_generation_race_aaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      tabsBeforeRetirement: null,
    })

    expect(localProjection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
    localProjection.destroy()
  })

  test('does not delete a durable session when its retiring runtime closes during restart', () => {
    const localProjection = new TerminalSessionProjection()
    localProjection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    localProjection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [
        makeServerSession('pty_generation_race_aaaa', 'term-111111111111111111111', {
          terminalRuntimeGeneration: 1,
        }),
      ],
      'client_local',
    )
    const session = requiredTerminalSession(localProjection, 'term-111111111111111111111')
    session.restart()

    localProjection.handleSessionClosed(sessionClosedEvent('pty_generation_race_aaaa', 1, 'term-111111111111111111111'))

    expect(localProjection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
    localProjection.destroy()
  })

  test('does not apply or retain a bell from the retiring runtime during restart', () => {
    const localProjection = new TerminalSessionProjection()
    localProjection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    localProjection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [
        makeServerSession('pty_generation_race_aaaa', 'term-111111111111111111111', {
          terminalRuntimeGeneration: 1,
        }),
      ],
      'client_local',
    )
    const session = requiredTerminalSession(localProjection, 'term-111111111111111111111')
    session.restart()

    localProjection.handleServerBell({
      terminalRuntimeSessionId: 'pty_generation_race_aaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      workspaceId: REPO_ROOT,
      processName: 'zsh',
      canonicalTitle: null,
    })

    expect(localProjection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).bellCount).toBe(0)
    localProjection.destroy()
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

  test('does not let a delayed partial create effect regress or replace a newer active binding', () => {
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
