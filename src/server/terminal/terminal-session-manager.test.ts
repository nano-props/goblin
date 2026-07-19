import { describe, expect, test, vi } from 'vitest'
import {
  terminalExecutionPath,
  type TerminalAttachResult,
  type TerminalSessionsSnapshot,
} from '#/shared/terminal-types.ts'
import {
  createPtyHandle,
  type PtyHandle,
  type PtySpawnResult,
  type PtySupervisor,
} from '#/server/terminal/pty-supervisor.ts'
import {
  TerminalSessionManager,
  type TerminalEnsureSessionInput,
  type TerminalEventSink,
} from '#/server/terminal/terminal-session-manager.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const USER_ID = 'user_terminal_session_manager'
const CLIENT_ID = 'client_terminal_session_manager'
const SCOPE = 'goblin+file:///repo\0repo-runtime-test'
const BRANCH_NAME = 'feature/test'
const WORKTREE_PATH = '/repo'
const TERMINAL_SESSION_ID = 'term-111111111111111111111'
const WORKSPACE_ID = requiredWorkspaceLocator('goblin+file:///repo')
const WORKTREE_TARGET = {
  kind: 'git-worktree' as const,
  workspaceId: WORKSPACE_ID,
  workspaceRuntimeId: 'repo-runtime-test',
  root: WORKSPACE_ID,
}
const LINKED_WORKTREE_TARGET = {
  ...WORKTREE_TARGET,
  workspaceRuntimeId: 'repo-runtime-linked',
  workspaceId: requiredWorkspaceLocator('goblin+file:///repo-linked'),
  root: requiredWorkspaceLocator('goblin+file:///repo-linked/worktree'),
}

function requiredWorkspaceLocator(input: string) {
  const locator = canonicalWorkspaceLocator(input)
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}

function createDeferredPtySupervisor(): PtySupervisor & {
  spawns: Array<(result: PtySpawnResult) => void>
  killed: string[]
  emitData(terminalRuntimeSessionId: string, data: string): void
  emitExit(terminalRuntimeSessionId: string): void
  setProcessName(processName: string): void
} {
  const spawns: Array<(result: PtySpawnResult) => void> = []
  const killed: string[] = []
  const dataListenersByPtySessionId = new Map<string, Set<(data: string) => void>>()
  const exitListenersByPtySessionId = new Map<string, Set<() => void>>()
  let currentProcessName = 'zsh'

  return {
    mode: 'in-process',
    spawns,
    killed,
    spawn: vi.fn(() => {
      return new Promise<PtySpawnResult>((resolve) => {
        spawns.push(resolve)
      })
    }),
    write: vi.fn(async () => ({ status: 'accepted' as const })),
    resize: vi.fn(),
    kill(handle) {
      killed.push(handle.ptySessionId)
    },
    async killAndWait(handle) {
      killed.push(handle.ptySessionId)
    },
    onData(handle, listener) {
      const listeners = dataListenersByPtySessionId.get(handle.ptySessionId) ?? new Set()
      listeners.add(listener)
      dataListenersByPtySessionId.set(handle.ptySessionId, listeners)
      return {
        // Keep callbacks callable after dispose so stale-event guards are exercised.
        dispose: vi.fn(),
      }
    },
    onExit(handle, listener) {
      const listeners = exitListenersByPtySessionId.get(handle.ptySessionId) ?? new Set()
      listeners.add(() => listener(null, null))
      exitListenersByPtySessionId.set(handle.ptySessionId, listeners)
      return {
        // Keep callbacks callable after dispose so stale-event guards are exercised.
        dispose: vi.fn(),
      }
    },
    processName() {
      return currentProcessName
    },
    getDiagnostics() {
      return {
        mode: 'in-process',
        state: 'running',
        workerRunning: false,
        workerPid: null,
        workerStartedAt: null,
        workerUptimeMs: null,
        pendingRequests: spawns.length,
        restartAttempts: 0,
        restartScheduled: false,
        shuttingDown: false,
        lastSuccessfulResponseAt: null,
        lastExitCode: null,
        lastExitSignal: null,
        lastFailure: null,
      }
    },
    shutdown: vi.fn(),
    emitData(ptySessionId, data) {
      for (const listener of Array.from(dataListenersByPtySessionId.get(ptySessionId) ?? [])) listener(data)
    },
    emitExit(ptySessionId) {
      for (const listener of Array.from(exitListenersByPtySessionId.get(ptySessionId) ?? [])) listener()
    },
    setProcessName(processName) {
      currentProcessName = processName
    },
  }
}

function createManager(supervisor: PtySupervisor, sink: Partial<TerminalEventSink<string>> = {}) {
  return new TerminalSessionManager<string>(
    supervisor,
    {
      onOutput: vi.fn(),
      onExit: vi.fn(),
      ...sink,
    },
    () => true,
  )
}

function ptySpawnSuccess(id: string): { ok: true; handle: PtyHandle; processName: string } {
  return { ok: true, handle: createPtyHandle(id), processName: 'zsh' }
}

async function createSession(
  manager: TerminalSessionManager<string>,
  supervisor: ReturnType<typeof createDeferredPtySupervisor>,
): Promise<Extract<TerminalAttachResult, { ok: true }>> {
  const pending = ensureSession(manager, {
    userId: USER_ID,
    target: WORKTREE_TARGET,
    terminalSessionId: TERMINAL_SESSION_ID,
    cwd: '/tmp',
    cols: 80,
    rows: 24,
    clientId: CLIENT_ID,
  })
  supervisor.spawns.shift()?.(ptySpawnSuccess('pty_initial_123456'))
  const result = await pending
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return result
}

function ensureSession(
  manager: TerminalSessionManager<string>,
  input: Omit<TerminalEnsureSessionInput<string>, 'physicalWorktreeCapability'>,
): Promise<TerminalAttachResult> {
  const prepared = manager.prepareSession({
    ...input,
    physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(terminalExecutionPath(input.target)),
  })
  if (!prepared.ok) return Promise.resolve(prepared)
  prepared.admission.commit({
    presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
  })
  prepared.admission.publishCommittedEffects()
  return manager.attachSession(
    input.userId,
    prepared.terminalRuntimeSessionId,
    input.cols,
    input.rows,
    input.clientId ?? CLIENT_ID,
    input.signal,
  )
}

describe('TerminalSessionManager fresh stream boundary', () => {
  test('rejects target-incompatible presentation before committing prepared or existing sessions', () => {
    const manager = createManager(createDeferredPtySupervisor())
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    }
    const prepared = manager.prepareSession(input)
    if (!prepared.ok) throw new Error(prepared.message)
    expect(() => prepared.admission.commit({ presentation: { kind: 'workspace-root' } })).toThrow(
      'error.invalid-arguments',
    )
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions).toEqual([])

    prepared.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })
    const baseline = manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE)
    const existing = manager.prepareSession(input)
    if (!existing.ok) throw new Error(existing.message)
    expect(() => existing.admission.commit({ presentation: { kind: 'workspace-root' } })).toThrow(
      'error.invalid-arguments',
    )
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE)).toEqual(baseline)
  })

  test('keeps a prepared admission unpublished when presence sampling fails', () => {
    let presenceFails = true
    const manager = new TerminalSessionManager<string>(
      createDeferredPtySupervisor(),
      { onOutput: vi.fn(), onExit: vi.fn() },
      () => {
        if (presenceFails) throw new Error('presence unavailable')
        return true
      },
    )
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    }
    const prepared = manager.prepareSession(input)
    if (!prepared.ok) throw new Error(prepared.message)
    expect(() =>
      prepared.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
      }),
    ).toThrow('presence unavailable')
    prepared.admission.abort()
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE)).toEqual({ revision: 0, sessions: [] })

    presenceFails = false
    const retry = manager.prepareSession(input)
    if (!retry.ok) throw new Error(retry.message)
    expect(
      retry.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
      }),
    ).toMatchObject({
      action: 'created',
      terminalProjectionEffect: { kind: 'delta', revision: 1 },
    })
  })

  test('keeps an existing admission unchanged when presence sampling fails', () => {
    let presenceFails = false
    const manager = new TerminalSessionManager<string>(
      createDeferredPtySupervisor(),
      { onOutput: vi.fn(), onExit: vi.fn() },
      () => {
        if (presenceFails) throw new Error('presence unavailable')
        return true
      },
    )
    const baseInput = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
      cols: 80,
      rows: 24,
    }
    const created = manager.prepareSession(baseInput)
    if (!created.ok) throw new Error(created.message)
    created.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })
    const before = manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE)

    presenceFails = true
    const existing = manager.prepareSession({ ...baseInput, clientId: CLIENT_ID })
    if (!existing.ok) throw new Error(existing.message)
    expect(() =>
      existing.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'renamed-branch' } },
      }),
    ).toThrow('presence unavailable')
    existing.admission.abort()
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE)).toEqual(before)

    presenceFails = false
    const retry = manager.prepareSession({ ...baseInput, clientId: CLIENT_ID })
    if (!retry.ok) throw new Error(retry.message)
    expect(
      retry.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'renamed-branch' } },
      }),
    ).toMatchObject({
      action: 'reused',
      terminalProjectionEffect: { kind: 'delta', revision: before.revision + 1 },
    })
  })

  test('retires a prepared opening session before attach without leaving catalog membership', () => {
    const manager = createManager(createDeferredPtySupervisor())
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
      cols: 80,
      rows: 24,
    })
    if (!prepared.ok) throw new Error(prepared.message)
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions).toHaveLength(0)
    expect(prepared.admission.kind).toBe('prepared')
    if (prepared.admission.kind === 'prepared') prepared.admission.abort()
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions).toEqual([])
  })

  test('defers an existing session attachment until placement admission commits', () => {
    const onIdentity = vi.fn()
    const onSessionsProjectionChanged = vi.fn()
    const manager = createManager(createDeferredPtySupervisor(), { onIdentity, onSessionsProjectionChanged })
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
      cols: 80,
      rows: 24,
    }
    const created = manager.prepareSession(input)
    if (!created.ok) throw new Error(created.message)
    created.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })
    created.admission.publishCommittedEffects()
    onSessionsProjectionChanged.mockClear()

    const aborted = manager.prepareSession({ ...input, clientId: 'client-aborted' })
    if (!aborted.ok) throw new Error(aborted.message)
    expect(aborted).toMatchObject({ ok: true })
    aborted.admission.abort()
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions[0]?.controller).toBeNull()

    const admitted = manager.prepareSession({ ...input, clientId: CLIENT_ID })
    if (!admitted.ok) throw new Error(admitted.message)
    const beforeRenameRevision = manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).revision
    const committed = admitted.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'renamed-branch' } },
    })
    expect(committed).toMatchObject({
      action: 'reused',
      controller: { clientId: CLIENT_ID },
      terminalProjectionEffect: { kind: 'delta', revision: beforeRenameRevision + 1 },
    })
    const renamedSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE)
    expect(committed.terminalProjectionEffect).toEqual({ kind: 'delta', revision: renamedSnapshot.revision })
    expect(renamedSnapshot.sessions[0]?.controller).toEqual({
      clientId: CLIENT_ID,
      status: 'connected',
    })
    expect(onIdentity).not.toHaveBeenCalled()
    admitted.admission.publishCommittedEffects()
    expect(onIdentity).toHaveBeenCalledOnce()
    expect(onSessionsProjectionChanged).toHaveBeenCalledOnce()
    expect(renamedSnapshot.sessions[0]?.presentation).toEqual({
      kind: 'git-worktree',
      head: { kind: 'branch', branchName: 'renamed-branch' },
    })
  })

  test('reports no catalog effect when reuse leaves presentation unchanged', () => {
    const manager = createManager(createDeferredPtySupervisor())
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
      cols: 80,
      rows: 24,
    }
    const created = manager.prepareSession(input)
    if (!created.ok) throw new Error(created.message)
    created.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })
    const beforeReuse = manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).revision

    const reused = manager.prepareSession({ ...input, clientId: CLIENT_ID })
    if (!reused.ok) throw new Error(reused.message)
    expect(
      reused.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
      }),
    ).toMatchObject({
      action: 'reused',
      terminalProjectionEffect: { kind: 'none' },
    })
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).revision).toBe(beforeReuse)
  })

  test('rejects reuse under a different worktree path even with the same physical identity', () => {
    const manager = createManager(createDeferredPtySupervisor())
    const physicalWorktreeCapability = testPhysicalWorktreeExecutionCapability(WORKTREE_PATH)
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability,
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    }
    const created = manager.prepareSession(input)
    if (!created.ok) throw new Error(created.message)
    created.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })

    expect(
      manager.prepareSession({
        ...input,
        target: { ...WORKTREE_TARGET, root: requiredWorkspaceLocator('goblin+file:///repo/other-worktree') },
      }),
    ).toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
  })

  test('publishes committed controller identity when its PTY resize fails', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const onlineClients = new Set([CLIENT_ID])
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { onOutput: vi.fn(), onExit: vi.fn(), onIdentity },
      (_userId, clientId) => onlineClients.has(clientId),
    )
    const created = await createSession(manager, supervisor)
    onlineClients.delete(CLIENT_ID)
    manager.handleClientPresenceChanged(USER_ID, CLIENT_ID, true)
    onIdentity.mockClear()
    vi.mocked(supervisor.resize).mockImplementationOnce(() => {
      throw new Error('resize failed')
    })

    const admission = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
      cols: 100,
      rows: 30,
      clientId: 'client-replacement',
    })
    onlineClients.add('client-replacement')
    if (!admission.ok) throw new Error(admission.message)

    expect(
      admission.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
      }),
    ).toMatchObject({
      action: 'reused',
      terminalRuntimeSessionId: created.terminalRuntimeSessionId,
      controller: { clientId: 'client-replacement', status: 'connected' },
      canonicalCols: 80,
      canonicalRows: 24,
    })
    admission.admission.publishCommittedEffects()

    expect(onIdentity).toHaveBeenCalledOnce()
    expect(onIdentity).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        terminalRuntimeSessionId: created.terminalRuntimeSessionId,
        controller: { clientId: 'client-replacement', status: 'connected' },
        canonicalCols: 80,
        canonicalRows: 24,
      }),
    )
  })

  test('rejects an existing admission after the PTY exits during placement preparation', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const manager = createManager(supervisor, { onIdentity })
    await createSession(manager, supervisor)

    const admission = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      clientId: 'client-after-exit',
    })
    if (!admission.ok) throw new Error(admission.message)
    onIdentity.mockClear()

    supervisor.emitExit('pty_initial_123456')

    expect(() =>
      admission.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
      }),
    ).toThrow('error.unavailable')
    admission.admission.publishCommittedEffects()
    expect(onIdentity).not.toHaveBeenCalled()
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions).toEqual([])
  })

  test('rejects an existing admission while retirement is in progress', async () => {
    let finishRetirement: (() => void) | undefined
    const supervisor = createDeferredPtySupervisor()
    supervisor.killAndWait = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          finishRetirement = resolve
        }),
    )
    const onIdentity = vi.fn()
    const manager = createManager(supervisor, { onIdentity })
    const created = await createSession(manager, supervisor)
    const admission = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      clientId: 'client-during-close',
    })
    if (!admission.ok) throw new Error(admission.message)
    onIdentity.mockClear()

    const retirement = manager.requestSessionRetirement(created.terminalRuntimeSessionId)

    expect(() =>
      admission.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
      }),
    ).toThrow('error.unavailable')
    admission.admission.publishCommittedEffects()
    expect(onIdentity).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(finishRetirement).toBeTypeOf('function'))
    finishRetirement?.()
    await expect(retirement).resolves.toBe(true)
  })

  test('prepares without spawning, then starts at fitted geometry and snapshots only later attaches', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onOutput = vi.fn()
    const onSessionsProjectionChanged = vi.fn()
    const manager = createManager(supervisor, { onOutput, onSessionsProjectionChanged })
    const siblingSnapshots: TerminalSessionsSnapshot[] = []
    onSessionsProjectionChanged.mockImplementation(() => {
      siblingSnapshots.push(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE))
    })
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
      command: '/bin/zsh',
      args: ['-l'],
      startupShellCommand: 'echo ready\r',
      env: { GOBLIN_TEST: '1' },
    })
    expect(prepared).toMatchObject({ ok: true })
    expect(supervisor.spawn).not.toHaveBeenCalled()
    if (!prepared.ok) return
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions).toEqual([])
    expect(
      prepared.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
      }),
    ).toMatchObject({
      action: 'created',
      phase: 'opening',
      terminalRuntimeGeneration: 0,
    })
    expect(onSessionsProjectionChanged).not.toHaveBeenCalled()
    prepared.admission.publishCommittedEffects()
    expect(onSessionsProjectionChanged).toHaveBeenCalledOnce()
    expect(siblingSnapshots).toMatchObject([
      { revision: 1, sessions: [{ terminalRuntimeGeneration: 0, phase: 'opening' }] },
    ])

    const freshAttach = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 123, 41, CLIENT_ID)
    expect(supervisor.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/bin/zsh',
        args: ['-l'],
        startupShellCommand: 'echo ready\r',
        cwd: '/tmp',
        cols: 123,
        rows: 41,
        env: { GOBLIN_TEST: '1' },
      }),
    )
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_fresh_stream_123456'))
    await expect(freshAttach).resolves.toMatchObject({
      ok: true,
      frame: 'stream',
      terminalRuntimeGeneration: 1,
      terminalProjectionEffect: { kind: 'delta', revision: 2 },
      canonicalCols: 123,
      canonicalRows: 41,
    })
    expect(onSessionsProjectionChanged).toHaveBeenCalledTimes(2)
    expect(onSessionsProjectionChanged).toHaveBeenLastCalledWith(USER_ID, {
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      revision: 2,
    })
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE)).toMatchObject({
      revision: 2,
      sessions: [{ terminalRuntimeGeneration: 1, phase: 'open' }],
    })
    expect(siblingSnapshots).toMatchObject([
      { revision: 1, sessions: [{ terminalRuntimeGeneration: 0, phase: 'opening' }] },
      { revision: 2, sessions: [{ terminalRuntimeGeneration: 1, phase: 'open' }] },
    ])

    await expect(
      manager.writeSession(USER_ID, prepared.terminalRuntimeSessionId, 'input before output', CLIENT_ID),
    ).resolves.toEqual({ status: 'accepted' })

    supervisor.emitData('pty_fresh_stream_123456', 'prompt')
    expect(onOutput).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ data: 'prompt', seq: 1, outputEra: 0 }))
    const recoveryAttach = await manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 123, 41, CLIENT_ID)
    expect(recoveryAttach).toMatchObject({
      ok: true,
      frame: 'snapshot',
      snapshot: 'prompt',
      snapshotSeq: 1,
      outputEra: 0,
    })
  })

  test('gives a concurrent later attach a snapshot after the fresh spawn completes', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    if (!prepared.ok) throw new Error(prepared.message)
    prepared.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })
    prepared.admission.publishCommittedEffects()

    const first = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 100, 30, CLIENT_ID)
    const second = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 120, 40, 'client-test-2')
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_concurrent_attach_123'))

    await expect(first).resolves.toMatchObject({ ok: true, frame: 'stream' })
    await expect(second).resolves.toMatchObject({
      ok: true,
      frame: 'snapshot',
      snapshot: '',
      snapshotSeq: 0,
    })
    expect(supervisor.spawn).toHaveBeenCalledOnce()
  })

  test('closes a prepared session without ever allocating a PTY', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    if (!prepared.ok) throw new Error(prepared.message)

    expect(manager.primaryTerminalSessionIdForFilesystemTarget(USER_ID, SCOPE, WORKSPACE_ID)).toBeNull()

    await expect(manager.closeSessionForUser(USER_ID, prepared.terminalRuntimeSessionId)).resolves.toBe(false)
    if (prepared.admission.kind === 'prepared') prepared.admission.abort()
    expect(supervisor.spawn).not.toHaveBeenCalled()
    expect(supervisor.killed).toEqual([])
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
  })
})

describe('TerminalSessionManager PTY spawn ownership', () => {
  test('waits for an in-flight fresh attach before reusing the same terminalSessionId', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onSessionsProjectionChanged = vi.fn()
    const manager = createManager(supervisor, { onSessionsProjectionChanged })

    const first = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    const second = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: '/tmp',
      cols: 100,
      rows: 30,
      clientId: CLIENT_ID,
    })

    expect(supervisor.spawns).toHaveLength(1)
    supervisor.spawns.shift()?.({ ok: false, message: 'spawn failed' })

    await expect(first).resolves.toEqual({ ok: false, message: 'spawn failed' })
    await expect(second).resolves.toEqual({ ok: false, message: 'spawn failed' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([
      expect.objectContaining({ phase: 'error', message: 'spawn failed' }),
    ])
    expect(onSessionsProjectionChanged).toHaveBeenCalledTimes(2)
    expect(onSessionsProjectionChanged).toHaveBeenLastCalledWith(USER_ID, {
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      revision: 2,
    })
  })

  test('kills a PTY that resolves after its session was closed before binding', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)

    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    const [openingSession] = await manager.listSessionsForUser(USER_ID, SCOPE)
    expect(openingSession).toBeDefined()
    expect(manager.primaryTerminalSessionIdForFilesystemTarget(USER_ID, SCOPE, WORKSPACE_ID)).toBe(TERMINAL_SESSION_ID)
    const close = manager.closeSessionForUser(USER_ID, openingSession!.terminalRuntimeSessionId)

    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_late_spawn_123456'))

    await expect(close).resolves.toBe(true)
    await expect(pending).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(manager.primaryTerminalSessionIdForFilesystemTarget(USER_ID, SCOPE, WORKSPACE_ID)).toBeNull()
    expect(supervisor.killed).toEqual(['pty_late_spawn_123456'])
  })

  test('reports scope close reason for repo cleanup', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onSessionClosed = vi.fn()
    const manager = createManager(supervisor, { onSessionClosed })
    const created = await createSession(manager, supervisor)
    expect(manager.primaryTerminalSessionIdForFilesystemTarget(USER_ID, SCOPE, WORKSPACE_ID)).toBe(TERMINAL_SESSION_ID)

    manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE).publishEffects()

    expect(manager.primaryTerminalSessionIdForFilesystemTarget(USER_ID, SCOPE, WORKSPACE_ID)).toBeNull()

    expect(onSessionClosed).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
      'scope',
    )
  })

  test('invalidates a workspace runtime session before failed PTY cleanup settles', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onSessionClosed = vi.fn()
    const manager = createManager(supervisor, { onSessionClosed })
    const created = await createSession(manager, supervisor)
    supervisor.killAndWait = vi
      .fn()
      .mockRejectedValueOnce(new Error('worker unavailable'))
      .mockRejectedValueOnce(new Error('worker unavailable'))
      .mockResolvedValue(undefined)

    const invalidation = manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)

    expect(invalidation.removedSessions).toEqual([
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
    ])
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(onSessionClosed).not.toHaveBeenCalled()

    invalidation.publishEffects()
    invalidation.publishEffects()

    expect(onSessionClosed).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
      'scope',
    )
    await vi.waitFor(() => expect(supervisor.killAndWait).toHaveBeenCalledTimes(3))
  })

  test('keeps a committed invalidation when publication effects fail', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor, {
      onSessionClosed: vi.fn(() => {
        throw new Error('publication failed')
      }),
    })
    await createSession(manager, supervisor)

    const invalidation = manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)

    expect(() => invalidation.publishEffects()).not.toThrow()
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
  })

  test('detaches every session even when summary process metadata throws', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)
    await createSession(manager, supervisor)
    await createSession(manager, supervisor)
    supervisor.processName = vi.fn(() => {
      throw new Error('process disappeared')
    })

    const invalidation = manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)

    expect(invalidation.removedSessions).toEqual([])
    invalidation.publishEffects()
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
  })

  test('does not reschedule an invalidated PTY retirement after shutdown', async () => {
    vi.useFakeTimers()
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)
    await createSession(manager, supervisor)
    supervisor.killAndWait = vi.fn(async () => {
      throw new Error('worker unavailable')
    })

    const invalidation = manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)
    invalidation.publishEffects()
    manager.forceShutdown()
    await vi.runOnlyPendingTimersAsync()

    expect(supervisor.killAndWait).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  test('reports detached-user close reason for detached TTL cleanup', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onSessionClosed = vi.fn()
    const manager = createManager(supervisor, { onSessionClosed })
    const created = await createSession(manager, supervisor)

    await manager.closeSessionsForUser(USER_ID)

    expect(onSessionClosed).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
      'detached-user',
    )
  })

  test('supersedes an older restart before spawning the latest replacement', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)
    const created = await createSession(manager, supervisor)

    const firstRestart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 100, 30, CLIENT_ID)
    const secondRestart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 120, 40, CLIENT_ID)

    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_restart_two_123'))

    await expect(firstRestart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(secondRestart).resolves.toMatchObject({
      ok: true,
      terminalRuntimeSessionId: created.terminalRuntimeSessionId,
      canonicalCols: 120,
      canonicalRows: 40,
    })

    expect(supervisor.killed).toEqual(['pty_initial_123456'])
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
    ])

    await expect(manager.closeSessionForUser(USER_ID, created.terminalRuntimeSessionId)).resolves.toBe(true)
    expect(supervisor.killed).toEqual(['pty_initial_123456', 'pty_restart_two_123'])
  })

  test('publishes only the latest restart failure when an older restart is superseded', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)
    const created = await createSession(manager, supervisor)

    const firstRestart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 100, 30, CLIENT_ID)
    const secondRestart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 120, 40, CLIENT_ID)

    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.({ ok: false, message: 'new restart failed' })

    await expect(firstRestart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(secondRestart).resolves.toEqual({ ok: false, message: 'new restart failed' })

    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: created.terminalRuntimeSessionId,
        terminalRuntimeGeneration: 3,
        phase: 'error',
        message: 'new restart failed',
      }),
    ])
  })

  test('attach waits past a stale restart failure for the active restart generation', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)
    const created = await createSession(manager, supervisor)

    const firstRestart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 100, 30, CLIENT_ID)
    const attach = manager.attachSession(USER_ID, created.terminalRuntimeSessionId, 100, 30, CLIENT_ID)
    const secondRestart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 120, 40, CLIENT_ID)

    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_restart_two_789'))

    await expect(firstRestart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(secondRestart).resolves.toMatchObject({
      ok: true,
      terminalRuntimeSessionId: created.terminalRuntimeSessionId,
      canonicalCols: 120,
      canonicalRows: 40,
    })
    await expect(attach).resolves.toMatchObject({
      ok: true,
      terminalRuntimeSessionId: created.terminalRuntimeSessionId,
      canonicalCols: 120,
      canonicalRows: 40,
    })
  })
})

describe('TerminalSessionManager physical worktree quiescence', () => {
  test('keeps the session authoritative when PTY exit re-enters close before kill acknowledgement', async () => {
    const supervisor = createDeferredPtySupervisor()
    let exitListener: (() => void) | null = null
    supervisor.onExit = vi.fn((_handle, listener) => {
      exitListener = listener
      return { dispose: vi.fn() }
    })
    let acknowledgeKill!: () => void
    const killAcknowledged = new Promise<void>((resolve) => {
      acknowledgeKill = resolve
    })
    supervisor.killAndWait = vi.fn(async () => {
      exitListener?.()
      await killAcknowledged
    })
    const onSessionClosed = vi.fn()
    const manager = createManager(supervisor, { onSessionClosed })
    const scope = terminalSessionRuntimeScope(WORKSPACE_ID, 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_reentrant_close_123'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    const close = manager.closeSessionForUser(USER_ID, created.terminalRuntimeSessionId)
    await Promise.resolve()
    await Promise.resolve()
    expect(onSessionClosed).not.toHaveBeenCalled()
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toHaveLength(1)

    acknowledgeKill()
    await expect(close).resolves.toBe(true)
    expect(onSessionClosed).toHaveBeenCalledOnce()
  })

  test('joins a concurrent direct close to the same acknowledged close operation', async () => {
    const supervisor = createDeferredPtySupervisor()
    let acknowledgeKill!: () => void
    const killAcknowledged = new Promise<void>((resolve) => {
      acknowledgeKill = resolve
    })
    const killAndWait = vi.fn(async () => await killAcknowledged)
    supervisor.killAndWait = killAndWait
    const onSessionClosed = vi.fn()
    const manager = createManager(supervisor, { onSessionClosed })
    const workspaceId = WORKSPACE_ID
    const scope = terminalSessionRuntimeScope(workspaceId, 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_concurrent_close_123'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    const quiescence = manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeExecutionCapability(WORKTREE_PATH))
    const directClose = manager.closeSessionForUser(USER_ID, created.terminalRuntimeSessionId)
    await Promise.resolve()
    expect(killAndWait).toHaveBeenCalledOnce()
    expect(onSessionClosed).not.toHaveBeenCalled()
    await expect(
      ensureSession(manager, {
        userId: USER_ID,
        target: WORKTREE_TARGET,
        terminalSessionId: TERMINAL_SESSION_ID,
        cwd: WORKTREE_PATH,
        cols: 80,
        rows: 24,
        clientId: CLIENT_ID,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(supervisor.spawns).toEqual([])

    acknowledgeKill()
    await expect(quiescence).resolves.toEqual({
      ok: true,
      scopes: [{ userId: USER_ID, workspaceId, workspaceRuntimeId: 'repo-runtime-test', scope }],
    })
    await expect(directClose).resolves.toBe(true)
    expect(onSessionClosed).toHaveBeenCalledOnce()
  })

  test('quiesces a physical worktree opened through a different repository entry', async () => {
    const supervisor = createDeferredPtySupervisor()
    supervisor.killAndWait = vi.fn(async () => {})
    const manager = createManager(supervisor)
    const linkedRepoRoot = requiredWorkspaceLocator('goblin+file:///repo-linked')
    const physicalWorktreePath = '/repo-linked/worktree'
    const scope = terminalSessionRuntimeScope(linkedRepoRoot, 'repo-runtime-linked')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: LINKED_WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: physicalWorktreePath,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_cross_repo_root_123'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    await expect(
      manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeExecutionCapability(physicalWorktreePath)),
    ).resolves.toEqual({
      ok: true,
      scopes: [{ userId: USER_ID, workspaceId: linkedRepoRoot, workspaceRuntimeId: 'repo-runtime-linked', scope }],
    })
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([])
  })

  test('waits for an in-flight spawn and its kill acknowledgement before reporting quiescence', async () => {
    const supervisor = createDeferredPtySupervisor()
    let acknowledgeKill!: () => void
    const killAcknowledged = new Promise<void>((resolve) => {
      acknowledgeKill = resolve
    })
    supervisor.killAndWait = vi.fn(async () => await killAcknowledged)
    const manager = createManager(supervisor)
    const workspaceId = WORKSPACE_ID
    const scope = terminalSessionRuntimeScope(workspaceId, 'repo-runtime-test')
    const pendingCreate = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })

    let quiesced = false
    const quiescence = manager
      .closeSessionsForPhysicalWorktree(testPhysicalWorktreeExecutionCapability(WORKTREE_PATH))
      .then((result) => {
        quiesced = true
        return result
      })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_quiescence_spawn_123'))
    await Promise.resolve()
    expect(quiesced).toBe(false)

    acknowledgeKill()
    await expect(quiescence).resolves.toEqual({
      ok: true,
      scopes: [{ userId: USER_ID, workspaceId, workspaceRuntimeId: 'repo-runtime-test', scope }],
    })
    await expect(pendingCreate).resolves.toEqual({ ok: false, message: 'error.unavailable' })
  })

  test('keeps a timed-out PTY addressable and reports its user scope for retry', async () => {
    const supervisor = createDeferredPtySupervisor()
    const killAndWait = vi.fn(async (_handle: PtyHandle): Promise<void> => {
      throw new Error('PTY close timed out')
    })
    supervisor.killAndWait = killAndWait
    const manager = createManager(supervisor)
    const workspaceId = WORKSPACE_ID
    const scope = terminalSessionRuntimeScope(workspaceId, 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_quiescence_123456'))
    await pending

    await expect(
      manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeExecutionCapability(WORKTREE_PATH)),
    ).resolves.toEqual({
      ok: false,
      scopes: [{ userId: USER_ID, workspaceId, workspaceRuntimeId: 'repo-runtime-test', scope }],
      message: 'PTY close timed out',
    })
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([
      expect.objectContaining({ phase: 'error', message: 'PTY close timed out' }),
    ])

    killAndWait.mockResolvedValueOnce(undefined)
    await expect(
      manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeExecutionCapability(WORKTREE_PATH)),
    ).resolves.toEqual({
      ok: true,
      scopes: [{ userId: USER_ID, workspaceId, workspaceRuntimeId: 'repo-runtime-test', scope }],
    })
    expect(killAndWait).toHaveBeenCalledTimes(2)
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([])
  })

  test('returns stale on abort while quiescence waits for late spawn retirement', async () => {
    const supervisor = createDeferredPtySupervisor()
    const killAcknowledged = Promise.withResolvers<void>()
    const killAndWait = vi.fn(async () => await killAcknowledged.promise)
    supervisor.killAndWait = killAndWait
    const manager = createManager(supervisor)
    const workspaceId = WORKSPACE_ID
    const scope = terminalSessionRuntimeScope(workspaceId, 'repo-runtime-test')
    const controller = new AbortController()
    const pendingCreate = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
      signal: controller.signal,
    })

    controller.abort()
    await expect(pendingCreate).resolves.toEqual({ ok: false, message: 'error.workspace-runtime-stale' })

    let quiesced = false
    const quiescence = manager
      .closeSessionsForPhysicalWorktree(testPhysicalWorktreeExecutionCapability(WORKTREE_PATH))
      .then((value) => {
        quiesced = true
        return value
      })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_late_abort_123456'))
    await vi.waitFor(() => expect(killAndWait).toHaveBeenCalledOnce())
    expect(quiesced).toBe(false)

    killAcknowledged.resolve()
    await expect(quiescence).resolves.toEqual({
      ok: true,
      scopes: [{ userId: USER_ID, workspaceId, workspaceRuntimeId: 'repo-runtime-test', scope }],
    })
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([])
  })

  test('retains a late-spawn owner after the first retirement failure and retries cleanup', async () => {
    const supervisor = createDeferredPtySupervisor()
    const killAndWait = vi.fn(async () => {})
    killAndWait.mockRejectedValueOnce(new Error('PTY close timed out'))
    supervisor.killAndWait = killAndWait
    const manager = createManager(supervisor)
    const workspaceId = WORKSPACE_ID
    const scope = terminalSessionRuntimeScope(workspaceId, 'repo-runtime-test')
    const controller = new AbortController()
    const pendingCreate = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
      signal: controller.signal,
    })

    controller.abort()
    await expect(pendingCreate).resolves.toEqual({ ok: false, message: 'error.workspace-runtime-stale' })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_late_retry_123456'))
    await vi.waitFor(() => expect(killAndWait).toHaveBeenCalledOnce())
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([
      expect.objectContaining({ phase: 'error', message: 'error.workspace-runtime-stale' }),
    ])
    await expect(
      manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeExecutionCapability(WORKTREE_PATH)),
    ).resolves.toEqual({
      ok: false,
      scopes: [{ userId: USER_ID, workspaceId, workspaceRuntimeId: 'repo-runtime-test', scope }],
      message: 'PTY close timed out',
    })
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([
      expect.objectContaining({ phase: 'error', message: 'PTY close timed out' }),
    ])
    expect(killAndWait).toHaveBeenCalledOnce()
    await Promise.resolve()

    await expect(
      manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeExecutionCapability(WORKTREE_PATH)),
    ).resolves.toEqual({
      ok: true,
      scopes: [{ userId: USER_ID, workspaceId, workspaceRuntimeId: 'repo-runtime-test', scope }],
    })
    expect(killAndWait).toHaveBeenCalledTimes(2)
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([])
  })

  test('waits for pre-restart PTY termination before spawning the replacement', async () => {
    const supervisor = createDeferredPtySupervisor()
    const termination = Promise.withResolvers<void>()
    supervisor.killAndWait = vi.fn(async () => await termination.promise)
    const manager = createManager(supervisor)
    const scope = terminalSessionRuntimeScope(WORKSPACE_ID, 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_before_barrier_123'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    const restart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 80, 24, CLIENT_ID)
    await Promise.resolve()
    await Promise.resolve()
    expect(supervisor.spawns).toEqual([])

    termination.resolve()
    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_after_barrier_1234'))
    await expect(restart).resolves.toMatchObject({ ok: true })
  })

  test('retains a timed-out pre-restart PTY until late exit can be confirmed', async () => {
    const supervisor = createDeferredPtySupervisor()
    const retiredPtySessionId = 'pty_before_restart_123'
    const replacementPtySessionId = 'pty_after_restart_1234'
    let retiredExited = false
    const killAndWait = vi.fn(async (handle: PtyHandle): Promise<void> => {
      if (handle.ptySessionId === retiredPtySessionId && !retiredExited) {
        throw new Error('PTY close timed out')
      }
    })
    supervisor.killAndWait = killAndWait
    const manager = createManager(supervisor)
    const scope = terminalSessionRuntimeScope(WORKSPACE_ID, 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess(retiredPtySessionId))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    await expect(manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 80, 24, CLIENT_ID)).resolves.toEqual(
      { ok: false, message: 'PTY close timed out' },
    )
    expect(supervisor.spawns).toEqual([])
    expect(killAndWait.mock.calls.map(([handle]) => handle.ptySessionId)).toEqual([retiredPtySessionId])

    retiredExited = true
    supervisor.emitExit(retiredPtySessionId)
    const retry = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 80, 24, CLIENT_ID)
    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess(replacementPtySessionId))
    await expect(retry).resolves.toMatchObject({ ok: true })
    await expect(manager.closeSessionForUser(USER_ID, created.terminalRuntimeSessionId)).resolves.toBe(true)
    expect(killAndWait.mock.calls.map(([handle]) => handle.ptySessionId)).toEqual([
      retiredPtySessionId,
      retiredPtySessionId,
      replacementPtySessionId,
    ])
  })
})

describe('TerminalSessionManager membership catalog', () => {
  test('advances the projection revision when a fresh binding outcome settles', async () => {
    const supervisor = createDeferredPtySupervisor()
    supervisor.processName = vi.fn(() => 'terminal')
    const manager = createManager(supervisor)
    const scope = terminalSessionRuntimeScope(WORKSPACE_ID, 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    const beforeBinding = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(beforeBinding.sessions[0]).toMatchObject({ terminalRuntimeGeneration: 1, processName: 'terminal' })

    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_default_process_123'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)
    const afterBinding = manager.terminalSessionsSnapshotForUser(USER_ID, scope)

    expect(afterBinding.revision).toBe(beforeBinding.revision + 1)
    expect(afterBinding.sessions[0]).toMatchObject({
      terminalRuntimeGeneration: 1,
      processName: 'terminal',
      phase: 'open',
    })
  })

  test('does not advance the projection revision for incremental runtime details', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)
    const scope = terminalSessionRuntimeScope(WORKSPACE_ID, 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_revision_123456'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    const createdSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(createdSnapshot.sessions).toEqual([
      expect.objectContaining({
        terminalSessionId: TERMINAL_SESSION_ID,
        processName: 'zsh',
        phase: 'open',
        cols: 80,
        rows: 24,
      }),
    ])

    supervisor.emitData('pty_revision_123456', 'first output')
    const openedSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(openedSnapshot.revision).toBe(createdSnapshot.revision)
    expect(openedSnapshot.sessions[0]).toMatchObject({ phase: 'open' })

    supervisor.emitData('pty_revision_123456', 'ordinary output')
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, scope).revision).toBe(openedSnapshot.revision)

    supervisor.setProcessName('node')
    supervisor.emitData('pty_revision_123456', 'process changed')
    const processSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(processSnapshot.revision).toBe(openedSnapshot.revision)
    expect(processSnapshot.sessions[0]).toMatchObject({ processName: 'node' })

    const beforeResize = processSnapshot.revision
    expect(manager.resizeSession(USER_ID, created.terminalRuntimeSessionId, 100, 30, CLIENT_ID)).toBe(true)
    const resizedSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(resizedSnapshot.revision).toBe(beforeResize)
    expect(resizedSnapshot.sessions[0]).toMatchObject({ cols: 100, rows: 30 })

    await expect(manager.closeSessionForUser(USER_ID, created.terminalRuntimeSessionId)).resolves.toBe(true)
    const closedSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(closedSnapshot.revision).toBe(resizedSnapshot.revision + 1)
    expect(closedSnapshot.sessions).toEqual([])
  })
})

describe('TerminalSessionManager runtime binding generations', () => {
  test('publishes the PTY binding generation on response frames and realtime events', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onOutput = vi.fn()
    const manager = createManager(supervisor, { onOutput })
    const created = await createSession(manager, supervisor)
    expect(created.terminalRuntimeGeneration).toBe(1)

    supervisor.emitData('pty_initial_123456', 'first')
    expect(onOutput).toHaveBeenLastCalledWith(USER_ID, expect.objectContaining({ terminalRuntimeGeneration: 1 }))

    const restart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 100, 30, CLIENT_ID)
    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_generation_two_123'))
    await expect(restart).resolves.toMatchObject({ ok: true, terminalRuntimeGeneration: 2 })

    supervisor.emitData('pty_generation_two_123', 'second')
    expect(onOutput).toHaveBeenLastCalledWith(USER_ID, expect.objectContaining({ terminalRuntimeGeneration: 2 }))
  })
})
