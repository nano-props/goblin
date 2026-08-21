import { describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { TerminalSessionSummary } from '#/shared/terminal-types.ts'
import type { CodedError } from '#/shared/coded-error.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import { createTerminalCommandApplication } from '#/server/terminal/terminal-command-application.ts'

const USER_ID = 'user_test'
const WORKSPACE_ID = workspaceIdForTest('goblin+file:///repo')
const RUNTIME_ID = 'runtime-test'
const CURRENT_ID = 'term-111111111111111111111'
const ORPHAN_ID = 'term-222222222222222222222'
const VALID_ID = 'term-333333333333333333333'

function session(terminalSessionId: string, terminalRuntimeSessionId: string, root?: string): TerminalSessionSummary {
  const target = root
    ? ({
        kind: 'git-worktree' as const,
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId: RUNTIME_ID,
        root: workspaceIdForTest(`goblin+file://${root}`),
      } as const)
    : ({ kind: 'workspace-root' as const, workspaceId: WORKSPACE_ID, workspaceRuntimeId: RUNTIME_ID } as const)
  return {
    terminalSessionId,
    terminalRuntimeSessionId,
    terminalRuntimeGeneration: 1,
    identityRevision: 1,
    target,
    presentation: root ? { kind: 'git-worktree' } : { kind: 'workspace-root' },
    controller: null,
    processName: 'zsh',
    canonicalTitle: root ? `shell ${root}` : 'root shell',
    phase: 'open',
    message: null,
    canonicalSize: { cols: 100, rows: 30 },
  } as TerminalSessionSummary
}

function gitProbe() {
  return {
    status: 'ready' as const,
    capabilities: {
      files: { read: true as const, write: true },
      terminal: { available: true as const },
      git: { status: 'available' as const, worktrees: true as const, pullRequests: { provider: 'none' as const } },
    },
    diagnostics: [],
  }
}

function filesystemProbe() {
  return {
    status: 'ready' as const,
    capabilities: {
      files: { read: true as const, write: true },
      terminal: { available: true as const },
      git: { status: 'unavailable' as const },
    },
    diagnostics: [],
  }
}

describe('terminal command application', () => {
  test('lists the current workspace terminals and identifies a prunable worktree as orphaned', async () => {
    const sessions = [
      session(CURRENT_ID, 'terminal-runtime-current'),
      session(ORPHAN_ID, 'terminal-runtime-orphan', '/repo/orphan'),
      session(VALID_ID, 'terminal-runtime-valid', '/repo/valid'),
    ]
    const manager = {
      getSessionSummaryForDurableId: vi.fn(() => sessions[0]!),
      listSessionsForUser: vi.fn(async () => sessions),
      closeSessionForUserOutcome: vi.fn(async () => ({ kind: 'closed' as const })),
    }
    const application = createTerminalCommandApplication({
      manager,
      workspaceProbe: vi.fn(() => gitProbe()),
      readWorktrees: vi.fn(async () => [
        { path: '/repo', headOid: '1'.repeat(40), branch: 'main', isBare: false, isPrimary: true },
        {
          path: '/repo/orphan',
          headOid: '2'.repeat(40),
          branch: 'orphan',
          isBare: false,
          isPrimary: false,
          isPrunable: true,
        },
        { path: '/repo/valid', headOid: '3'.repeat(40), branch: 'valid', isBare: false, isPrimary: false },
      ]),
    })

    const result = await application.execute(USER_ID, CURRENT_ID, ['list'])

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error('expected terminal list')
    expect(result.value.output).toContain(CURRENT_ID)
    expect(result.value.output).toContain(ORPHAN_ID)
    expect(result.value.output).toContain('orphaned')
    expect(result.value.output).toContain('valid')
    expect(result.value.output).toContain('main')
  })

  test('prunes only definitively orphaned worktree terminals', async () => {
    const sessions = [
      session(CURRENT_ID, 'terminal-runtime-current'),
      session(ORPHAN_ID, 'terminal-runtime-orphan', '/repo/missing'),
      session(VALID_ID, 'terminal-runtime-valid', '/repo/valid'),
    ]
    const manager = {
      getSessionSummaryForDurableId: vi.fn(() => sessions[0]!),
      listSessionsForUser: vi.fn(async () => sessions),
      closeSessionForUserOutcome: vi.fn(async () => ({ kind: 'closed' as const })),
    }
    const application = createTerminalCommandApplication({
      manager,
      workspaceProbe: vi.fn(() => gitProbe()),
      readWorktrees: vi.fn(async () => [
        { path: '/repo', headOid: '1'.repeat(40), branch: 'main', isBare: false, isPrimary: true },
        { path: '/repo/valid', headOid: '3'.repeat(40), branch: 'valid', isBare: false, isPrimary: false },
      ]),
    })

    const result = await application.execute(USER_ID, CURRENT_ID, ['prune'])

    expect(result).toEqual({ ok: true, value: { output: 'Pruned 1 orphan terminal.' } })
    expect(manager.closeSessionForUserOutcome).toHaveBeenCalledWith(USER_ID, 'terminal-runtime-orphan')
    expect(manager.closeSessionForUserOutcome).toHaveBeenCalledTimes(1)
  })

  test('does not close anything when worktree authority cannot be read', async () => {
    const sessions = [
      session(CURRENT_ID, 'terminal-runtime-current'),
      session(ORPHAN_ID, 'terminal-runtime-orphan', '/repo/missing'),
    ]
    const manager = {
      getSessionSummaryForDurableId: vi.fn(() => sessions[0]!),
      listSessionsForUser: vi.fn(async () => sessions),
      closeSessionForUserOutcome: vi.fn(async () => ({ kind: 'closed' as const })),
    }
    const application = createTerminalCommandApplication({
      manager,
      workspaceProbe: vi.fn(() => gitProbe()),
      readWorktrees: vi.fn(async () => await Promise.reject(new Error('git unavailable'))),
    })

    const result = await application.execute(USER_ID, CURRENT_ID, ['prune'])

    expect(result).toEqual({ ok: false, message: 'worktree state is unavailable; no terminals were closed' })
    expect(manager.closeSessionForUserOutcome).not.toHaveBeenCalled()
  })

  test('shows Git targets by branch and shortens local paths without terminal control characters', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///Users/example/Developer/repo')
    const current = {
      ...session(CURRENT_ID, 'terminal-runtime-current'),
      target: { kind: 'workspace-root' as const, workspaceId, workspaceRuntimeId: RUNTIME_ID },
      canonicalTitle: 'shell\u001b[31m title',
    } as TerminalSessionSummary
    const manager = {
      getSessionSummaryForDurableId: vi.fn(() => current),
      listSessionsForUser: vi.fn(async () => [current]),
      closeSessionForUserOutcome: vi.fn(async () => ({ kind: 'closed' as const })),
    }
    const application = createTerminalCommandApplication({
      manager,
      homeDir: '/Users/example',
      workspaceProbe: vi.fn(() => gitProbe()),
      readWorktrees: vi.fn(async () => [
        {
          path: '/Users/example/Developer/repo',
          headOid: '1'.repeat(40),
          branch: 'main',
          isBare: false,
          isPrimary: true,
        },
      ]),
    })

    const result = await application.execute(USER_ID, CURRENT_ID, [])

    expect(result).toEqual({
      ok: true,
      value: {
        output: expect.stringContaining('Target:       main'),
      },
    })
    if (!result.ok) throw new Error('expected terminal details')
    expect(result.value.output).toContain('Path:         ~/Developer/repo')
    expect(result.value.output).not.toContain('\u001b')
  })

  test('keeps workspace root as the target for a non-Git directory', async () => {
    const current = session(CURRENT_ID, 'terminal-runtime-current')
    const manager = {
      getSessionSummaryForDurableId: vi.fn(() => current),
      listSessionsForUser: vi.fn(async () => [current]),
      closeSessionForUserOutcome: vi.fn(async () => ({ kind: 'closed' as const })),
    }
    const application = createTerminalCommandApplication({
      manager,
      workspaceProbe: vi.fn(() => filesystemProbe()),
    })

    const result = await application.execute(USER_ID, CURRENT_ID, [])

    expect(result).toEqual({
      ok: true,
      value: { output: expect.stringContaining('Target:       workspace root') },
    })
  })

  test('passes request cancellation to the authoritative worktree read', async () => {
    const current = session(CURRENT_ID, 'terminal-runtime-current')
    const signal = new AbortController().signal
    const readWorktrees = vi.fn(async () => [
      { path: '/repo', headOid: '1'.repeat(40), branch: 'main', isBare: false, isPrimary: true },
    ])
    const application = createTerminalCommandApplication({
      manager: {
        getSessionSummaryForDurableId: vi.fn(() => current),
        listSessionsForUser: vi.fn(async () => [current]),
        closeSessionForUserOutcome: vi.fn(async () => ({ kind: 'closed' as const })),
      },
      workspaceProbe: vi.fn(() => gitProbe()),
      readWorktrees,
    })

    await application.execute(USER_ID, CURRENT_ID, ['list'], signal)

    expect(readWorktrees).toHaveBeenCalledWith(WORKSPACE_ID, { workspaceRuntimeId: RUNTIME_ID, signal })
  })

  test('orders the shell list with the same worktree and pane-tab authority as the dashboard', async () => {
    const sessions = [
      session(VALID_ID, 'terminal-runtime-valid', '/repo/valid'),
      session(ORPHAN_ID, 'terminal-runtime-other', '/repo/other'),
      session(CURRENT_ID, 'terminal-runtime-current', '/repo/valid'),
    ]
    const application = createTerminalCommandApplication({
      manager: {
        getSessionSummaryForDurableId: vi.fn(() => sessions[2]!),
        listSessionsForUser: vi.fn(async () => sessions),
        closeSessionForUserOutcome: vi.fn(async () => ({ kind: 'closed' as const })),
      },
      workspaceProbe: vi.fn(() => gitProbe()),
      readWorktrees: vi.fn(async () => [
        { path: '/repo', headOid: '1'.repeat(40), branch: 'main', isBare: false, isPrimary: true },
        { path: '/repo/valid', headOid: '2'.repeat(40), branch: 'valid', isBare: false, isPrimary: false },
        { path: '/repo/other', headOid: '3'.repeat(40), branch: 'other', isBare: false, isPrimary: false },
      ]),
      readPaneTabs: vi.fn(
        async () =>
          ({
            revision: 3,
            entries: [
              {
                target: sessions[0]!.target,
                tabs: [
                  { type: 'terminal', runtimeSessionId: CURRENT_ID },
                  { type: 'terminal', runtimeSessionId: VALID_ID },
                ],
              },
            ],
          }) satisfies WorkspacePaneTabsSnapshot,
      ),
    })

    const result = await application.execute(USER_ID, CURRENT_ID, ['list'])

    if (!result.ok) throw new Error('expected terminal list')
    expect(result.value.output.indexOf(CURRENT_ID)).toBeLessThan(result.value.output.indexOf(VALID_ID))
    expect(result.value.output.indexOf(VALID_ID)).toBeLessThan(result.value.output.indexOf(ORPHAN_ID))
  })

  test('does not shorten a remote path with the server home directory', async () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://prod/srv/repo')
    const current = {
      ...session(CURRENT_ID, 'terminal-runtime-current'),
      target: { kind: 'workspace-root' as const, workspaceId, workspaceRuntimeId: RUNTIME_ID },
    } as TerminalSessionSummary
    const application = createTerminalCommandApplication({
      manager: {
        getSessionSummaryForDurableId: vi.fn(() => current),
        listSessionsForUser: vi.fn(async () => [current]),
        closeSessionForUserOutcome: vi.fn(async () => ({ kind: 'closed' as const })),
      },
      homeDir: '/srv',
      workspaceProbe: vi.fn(() => filesystemProbe()),
    })

    const result = await application.execute(USER_ID, CURRENT_ID, [])

    if (!result.ok) throw new Error('expected terminal details')
    expect(result.value.output).toContain('Path:         /srv/repo')
    expect(result.value.output).not.toContain('~/repo')
  })

  test('fails fast on unsupported terminal arguments', async () => {
    const current = session(CURRENT_ID, 'terminal-runtime-current')
    const application = createTerminalCommandApplication({
      manager: {
        getSessionSummaryForDurableId: vi.fn(() => current),
        listSessionsForUser: vi.fn(async () => [current]),
        closeSessionForUserOutcome: vi.fn(async () => ({ kind: 'closed' as const })),
      },
    })

    await expect(application.execute(USER_ID, CURRENT_ID, ['unknown'])).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    } satisfies Partial<CodedError>)
  })
})
