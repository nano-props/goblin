// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import '#/web/test-utils/terminal-session-projection.ts'
import {
  getTerminalSessionProjection,
} from '#/web/terminal/components/TerminalSessionProjection.ts'
import { requiredTerminalSession } from '#/web/test-utils/terminal-session-projection-access.ts'
import {
  REPO_ROOT,
  WORKSPACE_RUNTIME_ID,
  WORKTREE_KEY,
  makeRuntimeMembershipIndex,
  makeServerSession,
  projection,
} from '#/web/test-utils/terminal-session-projection.ts'

describe('TerminalSessionProjection lifecycle', () => {
  test('returns cached snapshot without calling session.snapshot() repeatedly', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )

    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    const session = requiredTerminalSession(projection, terminalSessionId)

    const snapshotSpy = vi.spyOn(session, 'snapshot')
    const s1 = projection.snapshot(terminalSessionId)
    const s2 = projection.snapshot(terminalSessionId)
    expect(s1).toBe(s2)
    expect(snapshotSpy).not.toHaveBeenCalled()
  })

  test('invalidates snapshot cache on metadata notify', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )

    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    const s1 = projection.snapshot(terminalSessionId)

    projection.handleServerTitle({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId,
      workspaceId: REPO_ROOT,
      canonicalTitle: 'updated title',
    })
    const s2 = projection.snapshot(terminalSessionId)
    expect(s1).not.toBe(s2)
  })

  test('getTerminalSessionProjection returns the installed projection across calls', () => {
    const first = getTerminalSessionProjection({
      onSelectedFilesystemTargetChange: () => {},
    })
    const second = getTerminalSessionProjection({
      onSelectedFilesystemTargetChange: () => {},
    })
    expect(first).toBe(second)
    expect(first).toBe(projection)
  })

  test('destroy clears the singleton session when destroying the installed instance', () => {
    const original = getTerminalSessionProjection({
      onSelectedFilesystemTargetChange: () => {},
    })
    expect(original).toBe(projection)

    original.destroy()

    const fresh = getTerminalSessionProjection({
      onSelectedFilesystemTargetChange: () => {},
    })
    expect(fresh).not.toBe(original)
    fresh.destroy()
  })
})
