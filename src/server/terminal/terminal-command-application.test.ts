import { describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { TerminalSessionSummary } from '#/shared/terminal-types.ts'
import type { CodedError } from '#/shared/coded-error.ts'
import type { WorkspacePaneTargetMembership, WorkspacePaneWorktreeTargetIdentity } from '#/shared/git-types.ts'
import { createTerminalCommandApplication } from '#/server/terminal/terminal-command-application.ts'
import stringWidth from 'string-width'

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

function managerFor(sessions: TerminalSessionSummary[], current: TerminalSessionSummary | null = sessions[0]!) {
  return {
    getSessionSummaryForDurableId: vi.fn(() => current),
    listSessionsForUser: vi.fn(async () => sessions),
    closeSessionForUserOutcome: vi.fn(async (): Promise<{ kind: 'closed' | 'already-closed' | 'failed' }> => ({
      kind: 'closed',
    })),
  }
}

function worktreeIdentity(worktreePath: string, branchName: string): WorkspacePaneWorktreeTargetIdentity {
  return {
    kind: 'git-worktree',
    worktreePath,
    head: { kind: 'branch', branchName },
    materializedBranch: branchName,
  }
}

function gitMembership(
  sourcePath = '/repo',
  linkedWorktrees: WorkspacePaneWorktreeTargetIdentity[] = [],
): WorkspacePaneTargetMembership {
  return {
    source: { kind: 'worktree', identity: worktreeIdentity(sourcePath, 'main') },
    linkedWorktrees,
    branches: [],
  }
}

function outputLine(output: string, terminalSessionId: string): string {
  const line = output.split('\n').find((candidate) => candidate.includes(terminalSessionId))
  if (!line) throw new Error(`missing terminal row: ${terminalSessionId}`)
  return line
}

describe('terminal command application', () => {
  test('lists the current workspace terminals and identifies a missing worktree as orphaned', async () => {
    const sessions = [
      session(CURRENT_ID, 'terminal-runtime-current'),
      session(ORPHAN_ID, 'terminal-runtime-orphan', '/repo/orphan%20%20worktree'),
      {
        ...session(VALID_ID, 'terminal-runtime-valid', '/repo/my%20%20valid%20%20'),
        canonicalTitle: 'shell\t功能\nname',
      },
    ]
    const manager = managerFor(sessions)
    const application = createTerminalCommandApplication({
      manager,
      workspaceProbe: vi.fn(() => gitProbe()),
      readMembership: vi.fn(async () => gitMembership('/repo', [worktreeIdentity('/repo/my  valid  ', '功能')])),
    })

    const result = await application.execute(USER_ID, CURRENT_ID, ['list'])

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error('expected terminal list')
    expect(outputLine(result.value.output, CURRENT_ID)).toContain('available')
    expect(outputLine(result.value.output, CURRENT_ID)).toContain('main')
    expect(outputLine(result.value.output, ORPHAN_ID)).toContain('orphaned')
    expect(outputLine(result.value.output, ORPHAN_ID)).toContain('orphan  worktree')
    expect(outputLine(result.value.output, ORPHAN_ID)).toContain('/repo/orphan  worktree')
    expect(outputLine(result.value.output, VALID_ID)).toContain('available')
    expect(outputLine(result.value.output, VALID_ID)).toContain('功能')
    const lines = result.value.output.split('\n')
    const headings = lines[0] ?? ''
    const validLine = outputLine(result.value.output, VALID_ID)
    expect(lines).toHaveLength(4)
    expect(headings).toContain('CURRENT  ID')
    expect(validLine).toContain('shell 功能 name')
    expect(validLine.endsWith('/repo/my  valid  ')).toBe(true)
    expect(stringWidth(validLine.slice(0, validLine.indexOf('/repo/my  valid')))).toBe(
      stringWidth(headings.slice(0, headings.indexOf('PATH'))),
    )
    expect(result.value.output).not.toContain('\t')
  })

  test('prunes only definitively orphaned worktree terminals', async () => {
    const sessions = [
      session(CURRENT_ID, 'terminal-runtime-current'),
      session(ORPHAN_ID, 'terminal-runtime-orphan', '/repo/missing'),
      session(VALID_ID, 'terminal-runtime-valid', '/repo/valid'),
    ]
    const manager = managerFor(sessions)
    const application = createTerminalCommandApplication({
      manager,
      workspaceProbe: vi.fn(() => gitProbe()),
      readMembership: vi.fn(async () => gitMembership('/repo', [worktreeIdentity('/repo/valid', 'valid')])),
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
    const manager = managerFor(sessions)
    const application = createTerminalCommandApplication({
      manager,
      workspaceProbe: vi.fn(() => gitProbe()),
      readMembership: vi.fn(async () => await Promise.reject(new Error('git unavailable'))),
    })

    const result = await application.execute(USER_ID, CURRENT_ID, ['prune'])

    expect(result).toEqual({ ok: false, message: 'worktree state is unavailable; no terminals were closed' })
    expect(manager.closeSessionForUserOutcome).not.toHaveBeenCalled()
  })

  test('shows Git targets by branch and shortens local paths without terminal control characters', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///Users/example/Developer/my%20%20repo')
    const current = {
      ...session(CURRENT_ID, 'terminal-runtime-current'),
      target: { kind: 'workspace-root' as const, workspaceId, workspaceRuntimeId: RUNTIME_ID },
      canonicalTitle: 'shell\u001b[31m title',
    } as TerminalSessionSummary
    const manager = managerFor([current])
    const application = createTerminalCommandApplication({
      manager,
      homeDir: '/Users/example',
      workspaceProbe: vi.fn(() => gitProbe()),
      readMembership: vi.fn(async () => gitMembership('/Users/example/Developer/my  repo')),
    })

    const result = await application.execute(USER_ID, CURRENT_ID, [])

    expect(result).toEqual({
      ok: true,
      value: {
        output: expect.stringContaining('Target:       main'),
      },
    })
    if (!result.ok) throw new Error('expected terminal details')
    expect(result.value.output).toContain('Path:         ~/Developer/my  repo')
    expect(result.value.output).not.toContain('\u001b')
  })

  test('identifies the Git source by membership instead of the workspace path spelling', async () => {
    const current = session(CURRENT_ID, 'terminal-runtime-current')
    const application = createTerminalCommandApplication({
      manager: managerFor([current]),
      workspaceProbe: vi.fn(() => gitProbe()),
      readMembership: vi.fn(async () => gitMembership('/real/repo')),
    })

    const result = await application.execute(USER_ID, CURRENT_ID, [])

    if (!result.ok) throw new Error('expected terminal details')
    expect(result.value.output).toContain('Target:       main')
    expect(result.value.output).toContain('Availability: available')
  })

  test('keeps workspace root as the target for a non-Git directory', async () => {
    const current = session(CURRENT_ID, 'terminal-runtime-current')
    const manager = managerFor([current])
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
    const readMembership = vi.fn(async () => gitMembership())
    const application = createTerminalCommandApplication({
      manager: managerFor([current]),
      workspaceProbe: vi.fn(() => gitProbe()),
      readMembership,
    })

    await application.execute(USER_ID, CURRENT_ID, ['list'], signal)

    expect(readMembership).toHaveBeenCalledWith(WORKSPACE_ID, { workspaceRuntimeId: RUNTIME_ID, signal })
  })

  test('does not shorten a remote path with the server home directory', async () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://prod/srv/repo')
    const current = {
      ...session(CURRENT_ID, 'terminal-runtime-current'),
      target: { kind: 'workspace-root' as const, workspaceId, workspaceRuntimeId: RUNTIME_ID },
    } as TerminalSessionSummary
    const application = createTerminalCommandApplication({
      manager: managerFor([current]),
      homeDir: '/srv',
      workspaceProbe: vi.fn(() => gitProbe()),
      readMembership: vi.fn(async () => gitMembership('/srv/repo')),
    })

    const result = await application.execute(USER_ID, CURRENT_ID, [])

    if (!result.ok) throw new Error('expected terminal details')
    expect(result.value.output).toContain('Path:         /srv/repo')
    expect(result.value.output).not.toContain('~/repo')
  })

  test('fails fast on unsupported terminal arguments', async () => {
    const current = session(CURRENT_ID, 'terminal-runtime-current')
    const application = createTerminalCommandApplication({
      manager: managerFor([current]),
    })

    await expect(application.execute(USER_ID, CURRENT_ID, ['unknown'])).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    } satisfies Partial<CodedError>)
  })

  test('reports partial prune completion after attempting every orphan', async () => {
    const sessions = [
      session(CURRENT_ID, 'terminal-runtime-current'),
      session(ORPHAN_ID, 'terminal-runtime-orphan', '/repo/missing-a'),
      session(VALID_ID, 'terminal-runtime-failed', '/repo/missing-b'),
    ]
    const manager = managerFor(sessions)
    manager.closeSessionForUserOutcome
      .mockResolvedValueOnce({ kind: 'closed' })
      .mockResolvedValueOnce({ kind: 'failed' })
    const application = createTerminalCommandApplication({
      manager,
      workspaceProbe: vi.fn(() => gitProbe()),
      readMembership: vi.fn(async () => gitMembership()),
    })

    const result = await application.execute(USER_ID, CURRENT_ID, ['prune'])

    expect(result).toEqual({
      ok: false,
      message: 'Pruned 1 orphan terminal. Failed to close 1 orphan terminal.',
    })
    expect(manager.closeSessionForUserOutcome).toHaveBeenCalledTimes(2)
  })

  test('allows prune to close its own orphan terminal', async () => {
    const current = session(CURRENT_ID, 'terminal-runtime-current', '/repo/missing')
    const manager = managerFor([current])
    const application = createTerminalCommandApplication({
      manager,
      workspaceProbe: vi.fn(() => gitProbe()),
      readMembership: vi.fn(async () => gitMembership()),
    })

    const result = await application.execute(USER_ID, CURRENT_ID, ['prune'])

    expect(result).toEqual({ ok: true, value: { output: 'Pruned 1 orphan terminal.' } })
    expect(manager.closeSessionForUserOutcome).toHaveBeenCalledWith(USER_ID, 'terminal-runtime-current')
  })

  test('stops before prune mutation when the request is cancelled after inspection', async () => {
    const controller = new AbortController()
    const current = session(CURRENT_ID, 'terminal-runtime-current', '/repo/missing')
    const manager = managerFor([current])
    manager.listSessionsForUser.mockImplementation(async () => {
      controller.abort()
      return [current]
    })
    const application = createTerminalCommandApplication({
      manager,
      workspaceProbe: vi.fn(() => gitProbe()),
      readMembership: vi.fn(async () => gitMembership()),
    })

    await expect(application.execute(USER_ID, CURRENT_ID, ['prune'], controller.signal)).rejects.toThrow()
    expect(manager.closeSessionForUserOutcome).not.toHaveBeenCalled()
  })

  test('reports when the current terminal no longer exists', async () => {
    const manager = managerFor([], null)
    const application = createTerminalCommandApplication({ manager })

    await expect(application.execute(USER_ID, CURRENT_ID, ['list'])).resolves.toEqual({
      ok: false,
      message: 'current Goblin terminal is no longer available',
    })
    expect(manager.listSessionsForUser).not.toHaveBeenCalled()
  })
})
