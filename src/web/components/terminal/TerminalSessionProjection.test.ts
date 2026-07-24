// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  TerminalSessionProjection,
  getTerminalSessionProjection,
  setTerminalSessionProjectionForTests,
} from '#/web/components/terminal/TerminalSessionProjection.ts'
import { TerminalSession } from '#/web/components/terminal/TerminalSession.ts'
import { formatTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import type { TerminalDescriptor, TerminalRuntimeMembershipIndex } from '#/web/components/terminal/types.ts'
import type { TerminalSessionSummary } from '#/shared/terminal-types.ts'
import { terminalClient } from '#/web/terminal.ts'
import { resetWorkspacesStore } from '#/web/test-utils/bridge.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { runtimeMembershipIndexFromEntries } from '#/web/components/terminal/terminal-runtime-membership-index.ts'
import {
  requiredTerminalSession,
  terminalSessionProjectionAccess,
  terminalSessionRuntimeAccess,
} from '#/web/test-utils/terminal-session-projection-access.ts'

const workspacePaneRuntimeMocks = vi.hoisted(() => ({
  close: vi.fn(),
}))
const workspacePaneTabsCommitMocks = vi.hoisted(() => ({
  writeCanonicalSnapshot: vi.fn(() => true),
}))

vi.mock('#/web/workspace-pane/workspace-pane-runtime-client.ts', () => ({
  workspacePaneRuntimeClient: {
    close: workspacePaneRuntimeMocks.close,
  },
}))

vi.mock('#/web/workspace-pane/workspace-pane-tabs-commit.ts', () => ({
  writeCanonicalWorkspacePaneTabsSnapshot: workspacePaneTabsCommitMocks.writeCanonicalSnapshot,
}))

function workspaceIdFixture(input: string) {
  const workspaceId = canonicalWorkspaceLocator(input)
  if (!workspaceId) throw new Error('invalid workspace locator fixture')
  return workspaceId
}

const REPO_ROOT = workspaceIdFixture('goblin+file:///repo')
const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'
const WORKTREE_PATH = '/repo'
const BRANCH = 'main'
const WORKTREE_KEY = formatTerminalFilesystemTargetKey(REPO_ROOT, REPO_ROOT)
const WORKSPACE_ID = requiredWorkspaceLocator(REPO_ROOT)
const RUNTIME_TARGET = {
  kind: 'git-worktree' as const,
  workspaceId: WORKSPACE_ID,
  workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
  root: WORKSPACE_ID,
}

function requiredWorkspaceLocator(input: string) {
  const locator = canonicalWorkspaceLocator(input)
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}

function makeDescriptor(terminalSessionId: string, index: number): TerminalDescriptor {
  return {
    terminalSessionId,
    index,
    target: RUNTIME_TARGET,
    presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
  }
}

function makeRuntimeMembershipIndex(workspaceRuntimeId = WORKSPACE_RUNTIME_ID): TerminalRuntimeMembershipIndex {
  return runtimeMembershipIndexFromEntries([{ id: REPO_ROOT, workspaceRuntimeId }])
}

function makeServerSession(
  terminalRuntimeSessionId: string,
  terminalSessionId: string,
  overrides: Partial<{
    terminalRuntimeGeneration: number
    identityRevision: number
    controller: { clientId: string; status: 'connected' }
    processName: string
    canonicalTitle: string | null
    phase: 'opening' | 'restarting' | 'open' | 'error' | 'closed'
    message: string | null
    canonicalSize: { cols: number; rows: number } | null
    workspaceRuntimeId: string
  }> = {},
): TerminalSessionSummary {
  return {
    terminalRuntimeSessionId,
    terminalRuntimeGeneration: overrides.terminalRuntimeGeneration ?? 1,
    identityRevision: overrides.identityRevision ?? 0,
    terminalSessionId,
    target: { ...RUNTIME_TARGET, workspaceRuntimeId: overrides.workspaceRuntimeId ?? WORKSPACE_RUNTIME_ID },
    presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
    controller: overrides.controller ?? null,
    processName: overrides.processName ?? 'bash',
    canonicalTitle: overrides.canonicalTitle ?? null,
    phase: overrides.phase ?? 'open',
    message: overrides.message ?? null,
    canonicalSize: overrides.canonicalSize ?? { cols: 80, rows: 24 },
  }
}

function successfulRuntimeCloseSnapshot(
  terminalSessionId = 'term-111111111111111111111',
  terminalRuntimeSessionId: string | null = 'pty_session_1_aaaaaaaaa',
) {
  return {
    ok: true as const,
    runtimeType: 'terminal' as const,
    paneTabsSnapshot: { revision: 7, entries: [] },
    runtime:
      terminalRuntimeSessionId === null
        ? { action: 'already-closed' as const, terminalSessionId }
        : {
            action: 'closed' as const,
            terminalSessionId,
            terminalRuntimeSessionId,
            terminalRuntimeGeneration: 1,
          },
  }
}

describe('TerminalSessionProjection', () => {
  let projection: TerminalSessionProjection
  let selectedChanges: Array<{ terminalFilesystemTargetKey: string; terminalSessionId: string | null }>

  beforeEach(() => {
    resetWorkspacesStore()
    workspacePaneRuntimeMocks.close.mockReset()
    workspacePaneRuntimeMocks.close.mockResolvedValue(successfulRuntimeCloseSnapshot())
    workspacePaneTabsCommitMocks.writeCanonicalSnapshot.mockClear()
    selectedChanges = []
    projection = new TerminalSessionProjection((terminalFilesystemTargetKey, terminalSessionId) =>
      selectedChanges.push({ terminalFilesystemTargetKey, terminalSessionId }),
    )
    // Install into the singleton session so any code that reaches the
    // projection via `getTerminalSessionProjection()` (e.g., a Provider
    // mounted inside a sub-component) sees the same instance this
    // test constructed.
    setTerminalSessionProjectionForTests(projection)
  })

  afterEach(() => {
    vi.useRealTimers()
    // Drain pending state and clear listener maps on the per-test
    // instance, then release the singleton session so the next test
    // starts clean. Mirrors the production singleton-vs-test
    // contract documented at `setTerminalSessionProjectionForTests`.
    projection.destroy()
    setTerminalSessionProjectionForTests(null)
    resetWorkspacesStore()
  })

  test('rejects reconciliation for a workspace runtime outside the current repo index', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())

    const reconciled = projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: 'repo-runtime-old' },
      [
        makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111', {
          workspaceRuntimeId: 'repo-runtime-old',
        }),
      ],
      'client_local',
    )

    expect(reconciled).toBe(false)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('returns the session focus admission result', () => {
    const terminalSessionId = 'term-111111111111111111111'
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', terminalSessionId)],
      'client_local',
    )
    const session = requiredTerminalSession(projection, terminalSessionId)
    const request = { isCurrent: () => true, onSettled: vi.fn() }
    const focus = vi.spyOn(session, 'focus').mockReturnValueOnce(false).mockReturnValueOnce(true)

    expect(projection.focusTerminal(terminalSessionId, request)).toBe(false)
    expect(projection.focusTerminal(terminalSessionId, request)).toBe(true)
    expect(focus).toHaveBeenNthCalledWith(1, request)
    expect(focus).toHaveBeenNthCalledWith(2, request)
  })

  describe('versioned terminal session snapshots', () => {
    test('rejects older snapshots without evicting the accepted projection', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      expect(
        projection.reconcileServerSessionsSnapshot(
          { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
          {
            revision: 2,
            sessions: [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
          },
          'client_local',
        ),
      ).toBe(true)

      expect(
        projection.reconcileServerSessionsSnapshot(
          { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
          { revision: 1, sessions: [] },
          'client_local',
        ),
      ).toBe(false)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
    })

    test('accepts equal revisions for metadata refresh and higher revisions for removal', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      const scope = { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }
      projection.reconcileServerSessionsSnapshot(
        scope,
        {
          revision: 2,
          sessions: [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        },
        'client_local',
      )

      expect(
        projection.reconcileServerSessionsSnapshot(
          scope,
          {
            revision: 2,
            sessions: [
              makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111', {
                processName: 'node',
                canonicalTitle: 'build',
              }),
            ],
          },
          'client_local',
        ),
      ).toBe(true)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]).toMatchObject({
        processName: 'node',
        originalTitle: 'build',
      })

      expect(projection.reconcileServerSessionsSnapshot(scope, { revision: 3, sessions: [] }, 'client_local')).toBe(
        true,
      )
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('keeps an active exit terminal across repeated same-revision snapshots until authoritative absence', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      const scope = { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }
      const terminalSessionId = 'term-111111111111111111111'
      const terminalRuntimeSessionId = 'pty_active_exit_aaaaaaaaa'
      const snapshot = {
        revision: 10,
        sessions: [makeServerSession(terminalRuntimeSessionId, terminalSessionId)],
      }
      projection.reconcileServerSessionsSnapshot(scope, snapshot, 'client_local')

      projection.handleExit({
        terminalRuntimeSessionId,
        terminalRuntimeGeneration: 1,
        terminalSessionId,
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      })
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)

      expect(projection.reconcileServerSessionsSnapshot(scope, snapshot, 'client_local')).toBe(true)
      expect(projection.reconcileServerSessionsSnapshot(scope, snapshot, 'client_local')).toBe(true)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
      expect(terminalSessionProjectionAccess(projection).futureExitOrphans.size()).toBe(1)

      projection.reconcileServerSessionsSnapshot(scope, { revision: 11, sessions: [] }, 'client_local')
      expect(terminalSessionProjectionAccess(projection).futureExitOrphans.size()).toBe(0)
    })

    test('does not turn a gapped partial session delta into full catalog coverage', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      const scope = { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }
      const sessionA = makeServerSession('pty_delta_a_aaaaaaaaaaaa', 'term-111111111111111111111')
      const sessionB = makeServerSession('pty_delta_b_aaaaaaaaaaaa', 'term-222222222222222222222')
      projection.reconcileServerSessionsSnapshot(scope, { revision: 1, sessions: [sessionA] }, 'client_local')

      expect(
        terminalSessionProjectionAccess(projection).applyServerSessionEffect(
          scope,
          { kind: 'delta', revision: 3 },
          sessionA,
          'client_local',
        ),
      ).toBe(true)
      expect(projection.terminalSessionsCatalogCoverageRevision(scope)).toBe(1)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)

      projection.reconcileServerSessionsSnapshot(scope, { revision: 3, sessions: [sessionA, sessionB] }, 'client_local')
      expect(projection.terminalSessionsCatalogCoverageRevision(scope)).toBe(3)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(2)
    })

    test('advances catalog coverage for one continuous origin delta but not across a gap', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      const scope = { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }
      projection.reconcileServerSessionsSnapshot(scope, { revision: 1, sessions: [] }, 'client_local')

      expect(projection.applyTerminalSessionsDeltaRevision(scope, 2)).toBe(true)
      expect(projection.terminalSessionsCatalogCoverageRevision(scope)).toBe(2)
      expect(projection.applyTerminalSessionsDeltaRevision(scope, 4)).toBe(true)
      expect(projection.terminalSessionsCatalogCoverageRevision(scope)).toBe(2)
    })

    test('does not let an older exact exit tombstone block a newer runtime generation', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      const scope = { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }
      const terminalSessionId = 'term-111111111111111111111'
      const terminalRuntimeSessionId = 'pty_generation_exit_aaaaaa'
      projection.reconcileServerSessionsSnapshot(
        scope,
        {
          revision: 10,
          sessions: [makeServerSession(terminalRuntimeSessionId, terminalSessionId)],
        },
        'client_local',
      )
      projection.handleExit({
        terminalRuntimeSessionId,
        terminalRuntimeGeneration: 1,
        terminalSessionId,
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      })

      projection.reconcileServerSessionsSnapshot(
        scope,
        {
          revision: 11,
          sessions: [makeServerSession(terminalRuntimeSessionId, terminalSessionId, { terminalRuntimeGeneration: 2 })],
        },
        'client_local',
      )

      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
      expect(requiredTerminalSession(projection, terminalSessionId).currentRuntimeBinding()).toEqual({
        terminalRuntimeSessionId,
        terminalRuntimeGeneration: 2,
      })
    })

    test('uses a fresh revision epoch for a replacement workspace runtime and after destroy', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessionsSnapshot(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        { revision: 10, sessions: [] },
        'client_local',
      )
      const replacementRuntimeId = 'repo-runtime-replacement'
      projection.setRuntimeMembershipIndex(
        runtimeMembershipIndexFromEntries([{ id: REPO_ROOT, workspaceRuntimeId: replacementRuntimeId }]),
      )
      expect(
        projection.reconcileServerSessionsSnapshot(
          { workspaceId: REPO_ROOT, workspaceRuntimeId: replacementRuntimeId },
          {
            revision: 1,
            sessions: [
              makeServerSession('pty_session_b_aaaaaaaaa', 'term-222222222222222222222', {
                workspaceRuntimeId: replacementRuntimeId,
              }),
            ],
          },
          'client_local',
        ),
      ).toBe(true)

      projection.destroy()
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      expect(
        projection.reconcileServerSessionsSnapshot(
          { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
          { revision: 1, sessions: [] },
          'client_local',
        ),
      ).toBe(true)
    })
  })

  describe('event dispatch', () => {
    test('does not route realtime events through another session runtime binding', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )

      const session = requiredTerminalSession(projection, 'term-111111111111111111111')
      const handleOutputSpy = vi.spyOn(session, 'handleOutput')
      const handleServerTitleSpy = vi.spyOn(session, 'handleServerTitle')
      const handleExitSpy = vi.spyOn(session, 'handleExit')
      const handleIdentitySpy = vi.spyOn(session, 'handleIdentity')
      const handleLifecycleSpy = vi.spyOn(session, 'handleLifecycle')
      const contradictoryIdentity = {
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-222222222222222222222',
      }

      projection.handleOutput({
        ...contradictoryIdentity,
        data: 'must not be routed',
        seq: 1,
        processName: 'bash',
      })
      projection.handleServerBell({
        ...contradictoryIdentity,
        workspaceId: REPO_ROOT,
        processName: 'bash',
        canonicalTitle: null,
      })
      projection.handleServerTitle({
        ...contradictoryIdentity,
        workspaceId: REPO_ROOT,
        canonicalTitle: 'must not be routed',
      })
      projection.handleExit({
        ...contradictoryIdentity,
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      })
      projection.handleIdentity({
        ...contradictoryIdentity,
        identityRevision: 1,
        role: 'controller',
        controllerStatus: 'connected',
        canonicalSize: { cols: 100, rows: 30 },
      })
      projection.handleLifecycle({
        ...contradictoryIdentity,
        phase: 'open',
        message: null,
      })
      projection.handleSessionClosed(contradictoryIdentity)

      expect(handleOutputSpy).not.toHaveBeenCalled()
      expect(handleServerTitleSpy).not.toHaveBeenCalled()
      expect(handleExitSpy).not.toHaveBeenCalled()
      expect(handleIdentitySpy).not.toHaveBeenCalled()
      expect(handleLifecycleSpy).not.toHaveBeenCalled()
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).bellCount).toBe(0)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions).toHaveLength(1)
    })

    test('dispatches output by canonical terminalSessionId and validates its runtime binding', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )

      const terminalFilesystemTargetSnapshot = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY)
      const terminalSessionId = terminalFilesystemTargetSnapshot.sessions[0]!.terminalSessionId
      const session = requiredTerminalSession(projection, terminalSessionId)
      const handleOutputSpy = vi.spyOn(session, 'handleOutput')

      projection.handleOutput({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'hello',
        seq: 1,
        processName: 'bash',
      })
      expect(handleOutputSpy).toHaveBeenCalledTimes(1)

      projection.handleOutput({
        terminalRuntimeSessionId: 'pty_session_b_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'hello',
        seq: 1,
        processName: 'bash',
      })
      expect(handleOutputSpy).toHaveBeenCalledTimes(1)
    })

    test('does not mark empty output payloads as terminal output activity', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'))
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )

      const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = requiredTerminalSession(projection, terminalSessionId)
      const handleOutputSpy = vi.spyOn(session, 'handleOutput')

      projection.handleOutput({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: '',
        seq: 1,
        processName: 'bash',
      })
      vi.advanceTimersByTime(5000)
      projection.handleOutput({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: '',
        seq: 2,
        processName: 'bash',
      })

      expect(handleOutputSpy).toHaveBeenCalledTimes(2)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).outputActiveCount).toBe(0)
    })

    test('does not mark stale output payloads as terminal output activity', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )

      const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = requiredTerminalSession(projection, terminalSessionId)
      const handleOutputSpy = vi.spyOn(session, 'handleOutput')

      projection.handleOutput({
        terminalRuntimeSessionId: 'pty_session_old_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'stale output',
        seq: 1,
        processName: 'bash',
      })

      expect(handleOutputSpy).not.toHaveBeenCalled()
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).outputActiveCount).toBe(0)
    })

    test('rejects title changes whose canonical terminalSessionId does not resolve', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )

      const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = requiredTerminalSession(projection, terminalSessionId)
      const handleServerTitleSpy = vi.spyOn(session, 'handleServerTitle')

      projection.handleServerTitle({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-unroutedunroutedroute',
        workspaceId: REPO_ROOT,
        canonicalTitle: 'new title',
      })
      expect(handleServerTitleSpy).not.toHaveBeenCalled()

      handleServerTitleSpy.mockClear()
      projection.handleServerTitle({
        terminalRuntimeSessionId: 'pty_session_b_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-unroutedunroutedroute',
        workspaceId: REPO_ROOT,
        canonicalTitle: 'ignored',
      })
      expect(handleServerTitleSpy).not.toHaveBeenCalled()
    })

    test('dispatches title changes by canonical terminalSessionId', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )

      const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = requiredTerminalSession(projection, terminalSessionId)
      const handleServerTitleSpy = vi.spyOn(session, 'handleServerTitle')
      projection.handleServerTitle({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        workspaceId: REPO_ROOT,
        canonicalTitle: 'new title',
      })
      expect(handleServerTitleSpy).toHaveBeenCalledWith('new title')
    })

    test('ignores stale title changes for an old terminalRuntimeSessionId on the same terminalSessionId', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )

      const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = requiredTerminalSession(projection, terminalSessionId)
      const handleServerTitleSpy = vi.spyOn(session, 'handleServerTitle')

      projection.handleServerTitle({
        terminalRuntimeSessionId: 'pty_session_old_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        workspaceId: REPO_ROOT,
        canonicalTitle: 'stale title',
      })
      expect(handleServerTitleSpy).not.toHaveBeenCalled()
    })

    test('rejects exit whose canonical terminalSessionId does not resolve', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )

      const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = requiredTerminalSession(projection, terminalSessionId)
      const handleExitSpy = vi.spyOn(session, 'handleExit').mockReturnValue(true)

      projection.handleExit({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-unroutedunroutedroute',
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      })
      expect(handleExitSpy).not.toHaveBeenCalled()

      handleExitSpy.mockClear()
      projection.handleExit({
        terminalRuntimeSessionId: 'pty_session_b_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-unroutedunroutedroute',
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      })
      expect(handleExitSpy).not.toHaveBeenCalled()
    })

    test('routes output, exit, identity, and lifecycle by canonical terminalSessionId', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )

      const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = requiredTerminalSession(projection, terminalSessionId)
      const handleOutputSpy = vi.spyOn(session, 'handleOutput')
      const handleIdentitySpy = vi.spyOn(session, 'handleIdentity')
      const handleLifecycleSpy = vi.spyOn(session, 'handleLifecycle')
      const handleExitSpy = vi.spyOn(session, 'handleExit').mockReturnValue(true)
      projection.handleOutput({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'hello',
        seq: 1,
        processName: 'bash',
      })
      expect(handleOutputSpy).toHaveBeenCalledTimes(1)

      projection.handleIdentity({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        identityRevision: 1,
        terminalSessionId: 'term-111111111111111111111',
        role: 'controller',
        controllerStatus: 'connected',
        canonicalSize: { cols: 100, rows: 30 },
      })
      expect(handleIdentitySpy).toHaveBeenCalledTimes(1)

      projection.handleLifecycle({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        phase: 'open',
        message: null,
      })
      expect(handleLifecycleSpy).toHaveBeenCalledTimes(1)

      projection.handleExit({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      })
      expect(handleExitSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('notify granularity', () => {
    test('notifySession invalidates filesystem target cache', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )

      const listener = vi.fn()
      const unsubscribe = projection.subscribeTerminalFilesystemTarget(WORKTREE_KEY, listener)

      // Prime the cache
      projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY)
      listener.mockClear()

      // Simulate metadata change via internal notifySession
      const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      terminalSessionProjectionAccess(projection).notifySession(terminalSessionId)

      expect(listener).toHaveBeenCalledTimes(1)
      unsubscribe()
    })
  })

  describe('reconcileServerSessions', () => {
    test('creates missing local sessions and syncs selection', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())

      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )

      const snapshot = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY)
      expect(snapshot.count).toBe(1)
      expect(snapshot.sessions[0]!.terminalSessionId).toBe('term-111111111111111111111')
      expect(selectedChanges).toContainEqual({
        terminalFilesystemTargetKey: WORKTREE_KEY,
        terminalSessionId: snapshot.sessions[0]!.terminalSessionId,
      })
    })

    test('removes local sessions absent from the authoritative catalog', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      terminalSessionProjectionAccess(projection).ensureSession(makeDescriptor('term-111111111111111111111', 1))
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)

      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [],
        'client_local',
      )

      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('closeTerminalByDescriptor resolves after server terminal resources close', async () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )
      const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)

      let settled = false
      const closePromise = projection
        .closeTerminalByDescriptor(terminalSessionId, {
          target: RUNTIME_TARGET,
          presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
        })
        .then((result) => {
          settled = true
          return result
        })
      await Promise.resolve()

      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe(
        terminalSessionId,
      )
      expect(settled).toBe(false)

      serverClose.resolve(successfulRuntimeCloseSnapshot())
      await expect(closePromise).resolves.toBe(true)
      expect(settled).toBe(true)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('keeps command-closing sessions visible when server reconciliation removes them before close settles', async () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )
      const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)

      const closePromise = projection.closeTerminalByDescriptor(terminalSessionId, {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      })
      await Promise.resolve()

      expect(
        projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions.map((session) => session.terminalSessionId),
      ).toEqual([terminalSessionId])

      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [],
        'client_local',
      )

      expect(
        projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions.map((session) => session.terminalSessionId),
      ).toEqual([terminalSessionId])

      serverClose.resolve(successfulRuntimeCloseSnapshot())
      await expect(closePromise).resolves.toBe(true)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('keeps command-closing sessions visible when a session-closed event arrives before close settles', async () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )
      const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)

      const closePromise = projection.closeTerminalByDescriptor(terminalSessionId, {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      })
      await Promise.resolve()

      projection.handleSessionClosed({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId,
      })

      expect(
        projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions.map((summary) => summary.terminalSessionId),
      ).toEqual([terminalSessionId])

      serverClose.resolve(successfulRuntimeCloseSnapshot())
      await expect(closePromise).resolves.toBe(true)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('ignores a stale session-closed event after the durable terminal rebinds', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_2_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )

      projection.handleSessionClosed({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
      })

      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
      projection.handleSessionClosed({
        terminalRuntimeSessionId: 'pty_session_2_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
      })
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('uses the canonical durable session for an exact close', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )
      projection.handleSessionClosed({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
      })

      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('keeps an unknown runtime bell when a stale runtime close arrives', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.handleServerBell({
        terminalRuntimeSessionId: 'pty_session_2_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        workspaceId: REPO_ROOT,
        processName: 'bash',
        canonicalTitle: null,
      })

      projection.handleSessionClosed({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
      })
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_2_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )

      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]?.hasBell).toBe(true)
    })

    test('clears an unknown runtime bell when its exact runtime close arrives', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.handleServerBell({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        workspaceId: REPO_ROOT,
        processName: 'bash',
        canonicalTitle: null,
      })

      projection.handleSessionClosed({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
      })
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )

      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]?.hasBell).toBe(false)
    })

    test('keeps a rebound runtime when an older command close settles', async () => {
      const terminalSessionId = 'term-111111111111111111111'
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', terminalSessionId)],
        'client_local',
      )
      const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)
      const close = projection.closeTerminalByDescriptor(terminalSessionId, {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      })
      await Promise.resolve()

      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_2_aaaaaaaaa', terminalSessionId)],
        'client_local',
      )
      serverClose.resolve(successfulRuntimeCloseSnapshot(terminalSessionId, 'pty_session_1_aaaaaaaaa'))

      await expect(close).resolves.toBe(true)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
      expect(requiredTerminalSession(projection, terminalSessionId)?.currentTerminalRuntimeSessionId()).toBe(
        'pty_session_2_aaaaaaaaa',
      )
    })

    test('does not reuse a pending close across workspace runtime epochs', async () => {
      const terminalSessionId = 'term-111111111111111111111'
      const replacementWorkspaceRuntimeId = 'repo-runtime-replacement'
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', terminalSessionId)],
        'client_local',
      )
      const firstServerClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      const secondServerClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      workspacePaneRuntimeMocks.close
        .mockReturnValueOnce(firstServerClose.promise)
        .mockReturnValueOnce(secondServerClose.promise)

      const firstClose = projection.closeTerminalByDescriptor(terminalSessionId, {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      })
      await Promise.resolve()

      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex(replacementWorkspaceRuntimeId))
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: replacementWorkspaceRuntimeId },
        [
          makeServerSession('pty_session_2_aaaaaaaaa', terminalSessionId, {
            workspaceRuntimeId: replacementWorkspaceRuntimeId,
          }),
        ],
        'client_local',
      )
      const secondClose = projection.closeTerminalByDescriptor(terminalSessionId, {
        target: { ...RUNTIME_TARGET, workspaceRuntimeId: replacementWorkspaceRuntimeId },
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      })
      await Promise.resolve()

      expect(workspacePaneRuntimeMocks.close).toHaveBeenCalledTimes(2)
      firstServerClose.resolve(successfulRuntimeCloseSnapshot(terminalSessionId, 'pty_session_1_aaaaaaaaa'))
      await expect(firstClose).resolves.toBe(true)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)

      secondServerClose.resolve(successfulRuntimeCloseSnapshot(terminalSessionId, 'pty_session_2_aaaaaaaaa'))
      await expect(secondClose).resolves.toBe(true)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('closeTerminalByDescriptor selects an adjacent terminal after server close settles', async () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [
          makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111'),
          makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222'),
          makeServerSession('pty_session_3_aaaaaaaaa', 'term-333333333333333333333'),
        ],
        'client_local',
      )

      const activeSessionId = projection
        .terminalFilesystemTargetSnapshot(WORKTREE_KEY)
        .sessions.find((session) => session.terminalSessionId === 'term-222222222222222222222')?.terminalSessionId
      if (!activeSessionId) throw new Error('missing term-222222222222222222222')
      projection.selectTerminal(WORKTREE_KEY, activeSessionId)
      const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)

      const closePromise = projection.closeTerminalByDescriptor(activeSessionId, {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      })
      await Promise.resolve()

      const closingSnapshot = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY)
      expect(closingSnapshot.sessions.map((item) => item.terminalSessionId)).toEqual([
        'term-111111111111111111111',
        'term-222222222222222222222',
        'term-333333333333333333333',
      ])
      expect(closingSnapshot.selectedDescriptor?.terminalSessionId).toBe('term-222222222222222222222')

      serverClose.resolve(successfulRuntimeCloseSnapshot(activeSessionId, 'pty_session_2_aaaaaaaaa'))
      await expect(closePromise).resolves.toBe(true)
      const closedSnapshot = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY)
      expect(closedSnapshot.sessions.map((item) => item.terminalSessionId)).toEqual([
        'term-111111111111111111111',
        'term-333333333333333333333',
      ])
      expect(closedSnapshot.selectedDescriptor?.terminalSessionId).toBe('term-333333333333333333333')
    })

    test('commits the close response snapshot before applying its exact terminal effect', async () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [
          makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111'),
          makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222'),
        ],
        'client_local',
      )
      workspacePaneRuntimeMocks.close.mockResolvedValueOnce(
        successfulRuntimeCloseSnapshot('term-111111111111111111111', 'pty_session_1_aaaaaaaaa'),
      )

      await expect(
        projection.closeTerminalByDescriptor('term-111111111111111111111', {
          target: RUNTIME_TARGET,
          presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
        }),
      ).resolves.toBe(true)

      expect(workspacePaneTabsCommitMocks.writeCanonicalSnapshot).toHaveBeenCalledWith(
        REPO_ROOT,
        WORKSPACE_RUNTIME_ID,
        { revision: 7, entries: [] },
      )
      expect(
        projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions.map((session) => session.terminalSessionId),
      ).toEqual(['term-222222222222222222222'])
    })

    test('does not apply a stale close effect to a newly rebound runtime session', async () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_new_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )
      workspacePaneRuntimeMocks.close.mockResolvedValueOnce(
        successfulRuntimeCloseSnapshot('term-111111111111111111111', 'pty_session_old_aaaaaaaaa'),
      )

      await expect(
        projection.closeTerminalByDescriptor('term-111111111111111111111', {
          target: RUNTIME_TARGET,
          presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
        }),
      ).resolves.toBe(true)

      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
    })

    test('closeTerminalByDescriptor deduplicates repeated closes for the same terminal session', async () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )
      const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)

      const firstClose = projection.closeTerminalByDescriptor(terminalSessionId, {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      })
      const secondClose = projection.closeTerminalByDescriptor(terminalSessionId, {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      })
      await Promise.resolve()

      expect(workspacePaneRuntimeMocks.close).toHaveBeenCalledTimes(1)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)

      serverClose.resolve(successfulRuntimeCloseSnapshot())
      await expect(firstClose).resolves.toBe(true)
      await expect(secondClose).resolves.toBe(true)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('closeTerminalByDescriptor keeps the session when server resource close fails', async () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )
      const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = requiredTerminalSession(projection, terminalSessionId)
      const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)
      const dispose = vi.spyOn(session, 'dispose')

      const closePromise = projection.closeTerminalByDescriptor(terminalSessionId, {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      })
      await Promise.resolve()

      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)

      const expectation = expect(closePromise).resolves.toBe(false)
      serverClose.reject(new Error('close failed'))
      await expectation

      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe(
        'term-111111111111111111111',
      )
      expect(dispose).not.toHaveBeenCalled()
    })

    test('closeTerminalByDescriptor rejects a mismatched workspace runtime scope', async () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )
      const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      workspacePaneRuntimeMocks.close.mockResolvedValueOnce({
        ok: false,
        runtimeType: 'terminal',
        message: 'error.workspace-runtime-stale',
      })

      await expect(
        projection.closeTerminalByDescriptor(terminalSessionId, {
          target: { ...RUNTIME_TARGET, workspaceRuntimeId: 'repo-runtime-new' },
          presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
        }),
      ).resolves.toBe(false)

      expect(workspacePaneRuntimeMocks.close).toHaveBeenCalledOnce()
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
    })

    test('preserves current selection and falls back to controller when current is lost', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())

      // First reconcile: term-111111111111111111111 becomes current
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
      )
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe(
        'term-111111111111111111111',
      )

      // Second reconcile: term-111111111111111111111 removed, term-222222222222222222222 is controller
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [
          makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222', {
            controller: { clientId: 'client_local', status: 'connected' },
          }),
        ],
        'client_local',
      )
      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe(
        'term-222222222222222222222',
      )
    })

    test('closing the active terminal selects the adjacent tab in the server session list', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())

      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [
          makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222'),
          makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111'),
          makeServerSession('pty_session_3_aaaaaaaaa', 'term-333333333333333333333'),
        ],
        'client_local',
      )

      const snapshot = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY)
      const activeSessionId = snapshot.sessions.find(
        (session) => session.terminalSessionId === 'term-222222222222222222222',
      )?.terminalSessionId
      if (!activeSessionId) throw new Error('missing term-222222222222222222222')

      projection.selectTerminal(WORKTREE_KEY, activeSessionId)
      terminalSessionProjectionAccess(projection).removeSession(activeSessionId, { dispose: false })

      expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe(
        'term-111111111111111111111',
      )
    })

    test('invalidates cached filesystem target snapshot when the server session list changes', () => {
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [
          makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111'),
          makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222'),
        ],
        'client_local',
      )

      const firstSnapshot = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY)
      expect(firstSnapshot.sessions.map((session) => session.terminalSessionId)).toEqual([
        'term-111111111111111111111',
        'term-222222222222222222222',
      ])

      projection.reconcileServerSessions(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        [
          makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222'),
          makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111'),
        ],
        'client_local',
      )

      const secondSnapshot = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY)
      expect(secondSnapshot.sessions.map((session) => session.terminalSessionId)).toEqual([
        'term-222222222222222222222',
        'term-111111111111111111111',
      ])
    })
  })

  describe('snapshot cache', () => {
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
  })

  describe('singleton lifetime (P1.7)', () => {
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

    test('state added before a synthetic remount survives in the singleton session', () => {
      // Simulates the production invariant: Provider remounts
      // (StrictMode, route round-trip) reuse the singleton, so any
      // state injected before the remount is still visible after.
      projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
      const descriptor = makeDescriptor('term-111111111111111111111', 1)
      // Add a session through the projection's materialization seam without a
      // websocket or attached terminal view.
      terminalSessionProjectionAccess(projection).ensureSession(descriptor)
      // Synthesize a remount: re-fetch the singleton via the
      // getter (the Provider's mount effect does exactly this).
      const after = getTerminalSessionProjection({
        onSelectedFilesystemTargetChange: () => {},
      })
      expect(after).toBe(projection)
      // The session we injected is still in the projection's map —
      // i.e. the state survived the synthetic remount.
      const stored = requiredTerminalSession(after, descriptor.terminalSessionId)
      expect(stored.descriptor.terminalSessionId).toBe('term-111111111111111111111')
    })
  })
})

describe('TerminalSessionProjection runtime binding activation races', () => {
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

    localProjection.handleSessionClosed({
      terminalRuntimeSessionId: 'pty_generation_race_aaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
    })

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
    expect(terminalSessionProjectionAccess(localProjection).pendingServerBellByRuntimeBindingKey.size).toBe(0)
    localProjection.destroy()
  })

  test('consumes an exact future bell once when reconciliation activates its generation', () => {
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

    expect(localProjection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).bellCount).toBe(1)
    expect(terminalSessionProjectionAccess(localProjection).pendingServerBellByRuntimeBindingKey.size).toBe(0)
    localProjection.destroy()
  })

  test('refuses to activate a future generation that exited before reconciliation', () => {
    const localProjection = new TerminalSessionProjection()
    localProjection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    localProjection.handleExit({
      terminalRuntimeSessionId: 'pty_future_exit_aaaaaaaa',
      terminalRuntimeGeneration: 2,
      terminalSessionId: 'term-111111111111111111111',
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })

    localProjection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [
        makeServerSession('pty_future_exit_aaaaaaaa', 'term-111111111111111111111', {
          terminalRuntimeGeneration: 2,
        }),
      ],
      'client_local',
    )

    expect(localProjection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    localProjection.destroy()
  })

  test('ledgers a future-generation exit rejected by an active session until exact snapshot activation', () => {
    const localProjection = new TerminalSessionProjection()
    localProjection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    const terminalSessionId = 'term-111111111111111111111'
    const terminalRuntimeSessionId = 'pty_active_future_aaaaaaaa'
    localProjection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession(terminalRuntimeSessionId, terminalSessionId, { terminalRuntimeGeneration: 1 })],
      'client_local',
    )

    localProjection.handleExit({
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 2,
      terminalSessionId,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    localProjection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession(terminalRuntimeSessionId, terminalSessionId, { terminalRuntimeGeneration: 2 })],
      'client_local',
    )

    expect(localProjection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    localProjection.destroy()
  })

  test('ledgers a future-generation exit rejected by an error session until exact snapshot activation', () => {
    const localProjection = new TerminalSessionProjection()
    localProjection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    const terminalSessionId = 'term-111111111111111111111'
    const terminalRuntimeSessionId = 'pty_error_future_aaaaaaaaa'
    localProjection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession(terminalRuntimeSessionId, terminalSessionId, { terminalRuntimeGeneration: 1 })],
      'client_local',
    )
    const session = requiredTerminalSession(localProjection, terminalSessionId)
    const restartAttempt = terminalSessionRuntimeAccess(session).runtime.prepareRestart()
    if (!restartAttempt) throw new Error('expected restart attempt')
    terminalSessionRuntimeAccess(session).runtime.failStartAttempt(restartAttempt, 'error.restart-failed')

    localProjection.handleExit({
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 2,
      terminalSessionId,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    localProjection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession(terminalRuntimeSessionId, terminalSessionId, { terminalRuntimeGeneration: 2 })],
      'client_local',
    )

    expect(localProjection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    localProjection.destroy()
  })
})

describe('TerminalSessionProjection direct runtime activation barrier', () => {
  test('consumes the exact future bell on direct authoritative activation', () => {
    const localProjection = new TerminalSessionProjection()
    localProjection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    localProjection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [
        makeServerSession('pty_direct_activation_aaaa', 'term-111111111111111111111', {
          terminalRuntimeGeneration: 1,
        }),
      ],
      'client_local',
    )
    const session = requiredTerminalSession(localProjection, 'term-111111111111111111111')
    const bellBase = {
      terminalRuntimeSessionId: 'pty_direct_activation_aaaa',
      terminalSessionId: 'term-111111111111111111111',
      workspaceId: REPO_ROOT,
      processName: 'zsh',
      canonicalTitle: null,
    }
    localProjection.handleServerBell({ ...bellBase, terminalRuntimeGeneration: 2 })
    expect(localProjection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).bellCount).toBe(0)

    session.hydrate({
      terminalRuntimeSessionId: 'pty_direct_activation_aaaa',
      terminalRuntimeGeneration: 2,
      identityRevision: 0,
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 80, rows: 24 },
    })

    expect(localProjection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).bellCount).toBe(1)
    expect(terminalSessionProjectionAccess(localProjection).pendingServerBellByRuntimeBindingKey.size).toBe(0)
    localProjection.destroy()
  })
})

describe('TerminalSessionProjection new runtime lineage exit barrier', () => {
  const terminalSessionId = 'term-111111111111111111111'
  const lineageA = 'pty_lineage_a_aaaaaaaa'
  const lineageB = 'pty_lineage_b_aaaaaaaa'
  const lineageC = 'pty_lineage_c_aaaaaaaa'
  const exitFor = (terminalRuntimeSessionId: string) => ({
    terminalRuntimeSessionId,
    terminalRuntimeGeneration: 0,
    terminalSessionId,
    workspaceId: REPO_ROOT,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
  })

  function transitioningProjection(): { projection: TerminalSessionProjection; session: any } {
    const projection = new TerminalSessionProjection()
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession(lineageA, terminalSessionId, { terminalRuntimeGeneration: 1 })],
      'client_local',
    )
    const session = requiredTerminalSession(projection, terminalSessionId)
    session.restart()
    return { projection, session }
  }

  test('blocks direct activation when the replacement lineage exited before its attach response', () => {
    const { projection, session } = transitioningProjection()
    projection.handleExit(exitFor(lineageB))

    session.hydrate({
      terminalRuntimeSessionId: lineageB,
      terminalRuntimeGeneration: 0,
      identityRevision: 0,
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 80, rows: 24 },
    })

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    projection.destroy()
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

  test('blocks reconciliation activation of an exited replacement lineage', () => {
    const { projection } = transitioningProjection()
    projection.handleExit(exitFor(lineageB))

    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession(lineageB, terminalSessionId, { terminalRuntimeGeneration: 0 })],
      'client_local',
    )

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    projection.destroy()
  })

  test('keeps unrelated lineage exits when exact activation commits lineage C', () => {
    const { projection, session } = transitioningProjection()
    projection.handleExit(exitFor(lineageB))

    session.hydrate({
      terminalRuntimeSessionId: lineageC,
      terminalRuntimeGeneration: 0,
      identityRevision: 0,
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 80, rows: 24 },
    })

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
    expect(terminalSessionProjectionAccess(projection).futureExitOrphans.blocksActivation(exitFor(lineageB))).toBe(true)
    projection.destroy()
  })

  test('blocks a different-lineage activation when its exit arrived while lineage A was active', () => {
    const projection = new TerminalSessionProjection()
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession(lineageA, terminalSessionId, { terminalRuntimeGeneration: 1 })],
      'client_local',
    )
    projection.handleExit(exitFor(lineageB))

    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession(lineageB, terminalSessionId, { terminalRuntimeGeneration: 0 })],
      'client_local',
    )

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    projection.destroy()
  })

  test('preserves a generation 3 exit across generation 2 activation', () => {
    const { projection } = transitioningProjection()
    projection.handleExit({ ...exitFor(lineageA), terminalRuntimeGeneration: 3 })

    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession(lineageA, terminalSessionId, { terminalRuntimeGeneration: 2 })],
      'client_local',
    )
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)

    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession(lineageA, terminalSessionId, { terminalRuntimeGeneration: 3 })],
      'client_local',
    )
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    projection.destroy()
  })

  test('authoritative binding changes retire the older durable generation tombstone', () => {
    const { projection } = transitioningProjection()
    projection.handleExit({ ...exitFor(lineageA), terminalRuntimeGeneration: 3 })
    projection.handleExit({ ...exitFor(lineageA), terminalRuntimeGeneration: 2 })

    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession(lineageA, terminalSessionId, { terminalRuntimeGeneration: 2 })],
      'client_local',
    )
    expect(terminalSessionProjectionAccess(projection).futureExitOrphans.size()).toBe(2)

    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession(lineageA, terminalSessionId, { terminalRuntimeGeneration: 3 })],
      'client_local',
    )
    expect(terminalSessionProjectionAccess(projection).futureExitOrphans.size()).toBe(1)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    projection.destroy()
  })

  test('keeps an orphan exit when an unrelated repo epoch is replaced', () => {
    const projection = new TerminalSessionProjection()
    const otherRepoRoot = workspaceIdFixture('goblin+file:///repo-other')
    projection.setRuntimeMembershipIndex(
      runtimeMembershipIndexFromEntries([
        { id: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        { id: otherRepoRoot, workspaceRuntimeId: 'repo-runtime-other-1' },
      ]),
    )
    projection.handleExit(exitFor(lineageB))

    projection.setRuntimeMembershipIndex(
      runtimeMembershipIndexFromEntries([
        { id: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        { id: otherRepoRoot, workspaceRuntimeId: 'repo-runtime-other-2' },
      ]),
    )
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession(lineageB, terminalSessionId, { terminalRuntimeGeneration: 0 })],
      'client_local',
    )

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    projection.destroy()
  })
})
