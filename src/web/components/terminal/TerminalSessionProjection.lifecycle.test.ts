// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import '#/web/test-utils/terminal-session-projection.ts'
import { useFakeTimers } from '#/test-utils/timers.ts'
import {
  TerminalSessionProjection,
  getTerminalSessionProjection,
  setTerminalSessionProjectionForTests,
} from '#/web/components/terminal/TerminalSessionProjection.ts'
import { TerminalSession } from '#/web/components/terminal/TerminalSession.ts'
import { formatTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import type { TerminalDescriptor, TerminalRuntimeMembershipIndex } from '#/web/components/terminal/types.ts'
import type { TerminalSessionClosedEvent, TerminalSessionSummary } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { terminalClient } from '#/web/terminal.ts'
import { resetWorkspacesStore } from '#/web/test-utils/bridge.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { runtimeMembershipIndexFromEntries } from '#/web/components/terminal/terminal-runtime-membership-index.ts'
import {
  requiredTerminalSession,
  terminalSessionProjectionAccess,
  terminalSessionRuntimeAccess,
} from '#/web/test-utils/terminal-session-projection-access.ts'
import {
  BRANCH,
  REPO_ROOT,
  RUNTIME_TARGET,
  WORKSPACE_RUNTIME_ID,
  WORKTREE_KEY,
  WORKTREE_PATH,
  makeDescriptor,
  makeRuntimeMembershipIndex,
  makeServerSession,
  projection,
  selectedChanges,
  sessionClosedEvent,
  successfulRuntimeCloseSnapshot,
  tabsBeforeRetirement,
  workspacePaneRuntimeMocks,
  workspacePaneTabsCommitMocks,
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

    // reconcile pre-populates the cache; clear it to test the caching path
    terminalSessionProjectionAccess(projection).snapshotCache.delete(terminalSessionId)

    const snapshotSpy = vi.spyOn(session, 'snapshot')
    const s1 = projection.snapshot(terminalSessionId)
    const s2 = projection.snapshot(terminalSessionId)
    expect(s1).toBe(s2) // same reference
    expect(snapshotSpy).toHaveBeenCalledTimes(1)
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

    // metadata notify forces cache refresh
    terminalSessionProjectionAccess(projection).notifySession(terminalSessionId)
    const s2 = projection.snapshot(terminalSessionId)
    expect(s1).not.toBe(s2)
  })

  test('getTerminalSessionProjection returns the same instance across calls with the same deps', () => {
    // The session was filled by `beforeEach` with the per-test
    // `projection`. The getter must return that exact instance, not
    // construct a new one.
    const first = getTerminalSessionProjection({
      onSelectedFilesystemTargetChange: () => {},
    })
    const second = getTerminalSessionProjection({
      onSelectedFilesystemTargetChange: () => {},
    })
    expect(first).toBe(second)
    expect(first).toBe(projection)
  })

  test('setTerminalSessionProjectionForTests(null) clears the session so the next getter constructs a fresh instance', () => {
    const original = projection
    setTerminalSessionProjectionForTests(null)
    const fresh = getTerminalSessionProjection({
      onSelectedFilesystemTargetChange: () => {},
    })
    expect(fresh).not.toBe(original)
    // Re-install for `afterEach` cleanup.
    setTerminalSessionProjectionForTests(projection)
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
