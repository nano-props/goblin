import { describe, expect, test, vi } from 'vitest'
import { SerializeAddon } from '@xterm/addon-serialize'
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
import { createPtyEventChannel, type PtyEventSink } from '#/server/terminal/pty-event-lease.ts'
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
const ptyEventSinkById = new Map<string, PtyEventSink>()
const LINKED_WORKTREE_TARGET = {
  ...WORKTREE_TARGET,
  workspaceRuntimeId: 'repo-runtime-linked',
  workspaceId: requiredWorkspaceLocator('goblin+file:///repo-linked'),
  root: requiredWorkspaceLocator('goblin+file:///repo-linked/worktree'),
}

function createWorkspaceRuntimeRetentionHost() {
  return {
    retain: vi.fn(() => ({ release: vi.fn() })),
  }
}

function requiredWorkspaceLocator(input: string) {
  const locator = canonicalWorkspaceLocator(input)
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}

interface DeferredPtySupervisor extends PtySupervisor {
  spawns: Array<(result: PtySpawnResult) => void>
  killed: string[]
  emitData(terminalRuntimeSessionId: string, data: string): void
  emitExit(terminalRuntimeSessionId: string): void
  setProcessName(processName: string): void
}

function createDeferredPtySupervisor(): DeferredPtySupervisor {
  const spawns: Array<(result: PtySpawnResult) => void> = []
  const killed: string[] = []
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
    resize: vi.fn(async () => true),
    kill(handle) {
      killed.push(handle.ptySessionId)
    },
    waitForExit: vi.fn(() => new Promise<void>(() => {})),
    async killAndWait(handle) {
      killed.push(handle.ptySessionId)
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
      ptyEventSinkById.get(ptySessionId)?.data({ data, processName: currentProcessName })
    },
    emitExit(ptySessionId) {
      ptyEventSinkById.get(ptySessionId)?.exit(null, null)
    },
    setProcessName(processName) {
      currentProcessName = processName
    },
  }
}

function createManagerWithPresence(
  supervisor: PtySupervisor,
  sink: Partial<TerminalEventSink<string>>,
  isClientOnline: (clientId: string) => boolean,
) {
  return new TerminalSessionManager<string>(
    supervisor,
    {
      onOutput: vi.fn(),
      onExit: vi.fn(),
      ...sink,
    },
    (_userId, clientId) => isClientOnline(clientId),
    createWorkspaceRuntimeRetentionHost(),
  )
}

function createAlwaysOnlineManager(supervisor: PtySupervisor, sink: Partial<TerminalEventSink<string>> = {}) {
  return createManagerWithPresence(supervisor, sink, () => true)
}

function ptySpawnSuccess(id: string): Extract<PtySpawnResult, { ok: true }> {
  const events = createPtyEventChannel()
  ptyEventSinkById.set(id, events.sink)
  return { ok: true, handle: createPtyHandle(id), processName: 'zsh', events: events.lease }
}

async function createSession(
  manager: TerminalSessionManager<string>,
  supervisor: DeferredPtySupervisor,
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
  input: Omit<TerminalEnsureSessionInput<string>, 'physicalWorktreeCapability'> & {
    cols: number
    rows: number
    clientId?: string
  },
): Promise<TerminalAttachResult> {
  const { cols, rows, clientId = CLIENT_ID, ...prepareInput } = input
  const prepared = manager.prepareSession({
    ...prepareInput,
    physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(terminalExecutionPath(prepareInput.target)),
  })
  if (!prepared.ok) return Promise.resolve(prepared)
  const committed = prepared.admission.commit({
    presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
  })
  prepared.admission.publishCommittedEffects()
  return manager.attachSession(
    input.userId,
    prepared.terminalRuntimeSessionId,
    committed.terminalRuntimeGeneration,
    cols,
    rows,
    clientId,
    input.signal,
  )
}

describe('TerminalSessionManager fresh stream boundary', () => {
  test('rejects target-incompatible presentation before committing prepared or existing sessions', () => {
    const manager = createAlwaysOnlineManager(createDeferredPtySupervisor())
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
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

  test('prepares a session without sampling client presence', () => {
    let presenceFails = true
    const manager = new TerminalSessionManager<string>(
      createDeferredPtySupervisor(),
      { onOutput: vi.fn(), onExit: vi.fn() },
      () => {
        if (presenceFails) throw new Error('presence unavailable')
        return true
      },
      createWorkspaceRuntimeRetentionHost(),
    )
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    }
    const prepared = manager.prepareSession(input)
    if (!prepared.ok) throw new Error(prepared.message)
    expect(
      prepared.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
      }),
    ).toMatchObject({
      action: 'created',
      terminalProjectionEffect: { kind: 'delta', revision: 1 },
    })
  })

  test('updates an existing presentation without sampling client presence', () => {
    let presenceFails = false
    const manager = new TerminalSessionManager<string>(
      createDeferredPtySupervisor(),
      { onOutput: vi.fn(), onExit: vi.fn() },
      () => {
        if (presenceFails) throw new Error('presence unavailable')
        return true
      },
      createWorkspaceRuntimeRetentionHost(),
    )
    const baseInput = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    }
    const created = manager.prepareSession(baseInput)
    if (!created.ok) throw new Error(created.message)
    created.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })
    const before = manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE)

    presenceFails = true
    const existing = manager.prepareSession(baseInput)
    if (!existing.ok) throw new Error(existing.message)
    expect(
      existing.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'renamed-branch' } },
      }),
    ).toMatchObject({
      action: 'reused',
      terminalProjectionEffect: { kind: 'delta', revision: before.revision + 1 },
    })
  })

  test('retires a prepared opening session before attach without leaving catalog membership', () => {
    const manager = createAlwaysOnlineManager(createDeferredPtySupervisor())
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    })
    if (!prepared.ok) throw new Error(prepared.message)
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions).toHaveLength(0)
    expect(prepared.admission.kind).toBe('prepared')
    if (prepared.admission.kind === 'prepared') prepared.admission.abort()
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions).toEqual([])
  })

  test('defers an existing presentation mutation until placement admission commits', () => {
    const onIdentity = vi.fn()
    const onSessionsProjectionChanged = vi.fn()
    const manager = createAlwaysOnlineManager(createDeferredPtySupervisor(), {
      onIdentity,
      onSessionsProjectionChanged,
    })
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    }
    const created = manager.prepareSession(input)
    if (!created.ok) throw new Error(created.message)
    created.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })
    created.admission.publishCommittedEffects()
    onSessionsProjectionChanged.mockClear()

    const aborted = manager.prepareSession(input)
    if (!aborted.ok) throw new Error(aborted.message)
    expect(aborted).toMatchObject({ ok: true })
    aborted.admission.abort()
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions[0]?.controller).toBeNull()

    const admitted = manager.prepareSession(input)
    if (!admitted.ok) throw new Error(admitted.message)
    const beforeRenameRevision = manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).revision
    const committed = admitted.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'renamed-branch' } },
    })
    expect(committed).toMatchObject({
      action: 'reused',
      controller: null,
      terminalProjectionEffect: { kind: 'delta', revision: beforeRenameRevision + 1 },
    })
    const renamedSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE)
    expect(committed.terminalProjectionEffect).toEqual({ kind: 'delta', revision: renamedSnapshot.revision })
    expect(renamedSnapshot.sessions[0]?.controller).toBeNull()
    expect(onIdentity).not.toHaveBeenCalled()
    admitted.admission.publishCommittedEffects()
    expect(onIdentity).not.toHaveBeenCalled()
    expect(onSessionsProjectionChanged).toHaveBeenCalledOnce()
    expect(renamedSnapshot.sessions[0]?.presentation).toEqual({
      kind: 'git-worktree',
      head: { kind: 'branch', branchName: 'renamed-branch' },
    })
  })

  test('reports no catalog effect when reuse leaves presentation unchanged', () => {
    const manager = createAlwaysOnlineManager(createDeferredPtySupervisor())
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    }
    const created = manager.prepareSession(input)
    if (!created.ok) throw new Error(created.message)
    created.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })
    const beforeReuse = manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).revision

    const reused = manager.prepareSession(input)
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
    const manager = createAlwaysOnlineManager(createDeferredPtySupervisor())
    const physicalWorktreeCapability = testPhysicalWorktreeExecutionCapability(WORKTREE_PATH)
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability,
      cwd: '/tmp',
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

  test('does not commit a replacement controller when its PTY resize fails', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const onlineClients = new Set([CLIENT_ID])
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { onOutput: vi.fn(), onExit: vi.fn(), onIdentity },
      (_userId, clientId) => onlineClients.has(clientId),
      createWorkspaceRuntimeRetentionHost(),
    )
    const created = await createSession(manager, supervisor)
    onlineClients.delete(CLIENT_ID)
    manager.handleClientPresenceChanged(USER_ID, CLIENT_ID, true)
    onIdentity.mockClear()
    vi.mocked(supervisor.resize).mockImplementationOnce(() => {
      throw new Error('resize failed')
    })

    onlineClients.add('client-replacement')
    await expect(
      manager.attachSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration,
        100,
        30,
        'client-replacement',
      ),
    ).resolves.toEqual({ ok: false, message: 'error.unavailable' })

    expect(onIdentity).not.toHaveBeenCalled()
    expect(manager.getSessionSummaryForUser(USER_ID, created.terminalRuntimeSessionId)).toMatchObject({
      controller: null,
      canonicalSize: { cols: 80, rows: 24 },
    })
  })

  test('serializes concurrent recovery attachments into one controller decision', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onlineClients = new Set([CLIENT_ID, 'client-b', 'client-c'])
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { onOutput: vi.fn(), onExit: vi.fn(), onIdentity: vi.fn() },
      (_userId, clientId) => onlineClients.has(clientId),
      createWorkspaceRuntimeRetentionHost(),
    )
    const created = await createSession(manager, supervisor)
    await expect(
      manager.attachSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration,
        80,
        24,
        'client-b',
      ),
    ).resolves.toMatchObject({ ok: true, frame: 'snapshot', controller: { clientId: CLIENT_ID } })
    manager.expireClientAttachments(USER_ID, CLIENT_ID)

    const nativeResize = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockImplementationOnce(async () => await nativeResize.promise)
    const controllerAttach = manager.attachSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      'client-b',
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledTimes(1))
    const viewerAttach = manager.attachSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      'client-c',
    )

    nativeResize.resolve(true)
    await expect(controllerAttach).resolves.toMatchObject({
      ok: true,
      frame: 'snapshot',
      controller: { clientId: 'client-b' },
      canonicalSize: { cols: 100, rows: 30 },
    })
    await expect(viewerAttach).resolves.toMatchObject({
      ok: true,
      frame: 'snapshot',
      controller: { clientId: 'client-b' },
      canonicalSize: { cols: 100, rows: 30 },
    })
    expect(supervisor.resize).toHaveBeenCalledTimes(1)
  })

  test('rejects an old controller resize queued behind a committed takeover', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const created = await createSession(manager, supervisor)
    await manager.attachSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      80,
      24,
      'client-b',
    )

    const nativeResize = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockImplementationOnce(async () => await nativeResize.promise)
    const takeover = manager.takeoverSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      'client-b',
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledTimes(1))
    const staleResize = manager.resizeSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )

    nativeResize.resolve(true)
    await expect(takeover).resolves.toMatchObject({
      ok: true,
      controller: { clientId: 'client-b' },
      canonicalSize: { cols: 120, rows: 40 },
    })
    await expect(staleResize).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(supervisor.resize).toHaveBeenCalledTimes(1)
    expect(manager.getSessionSummaryForUser(USER_ID, created.terminalRuntimeSessionId)).toMatchObject({
      controller: { clientId: 'client-b' },
      canonicalSize: { cols: 120, rows: 40 },
    })
  })

  test('does not let a stale takeover acknowledgement mutate a replacement binding', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onIdentity })
    const created = await createSession(manager, supervisor)
    const viewerClientId = 'client-stale-takeover'
    await manager.attachSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      80,
      24,
      viewerClientId,
    )
    onIdentity.mockClear()

    const oldResizeAcknowledged = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockImplementationOnce(async () => await oldResizeAcknowledged.promise)
    const takeover = manager.takeoverSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      viewerClientId,
    )
    await vi.waitFor(() =>
      expect(supervisor.resize).toHaveBeenCalledWith({ ptySessionId: 'pty_initial_123456' }, 120, 40),
    )

    const restart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )
    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_after_stale_takeover_123456'))
    await expect(restart).resolves.toMatchObject({
      ok: true,
      frame: 'stream',
      terminalRuntimeGeneration: created.terminalRuntimeGeneration + 1,
      controller: { clientId: CLIENT_ID },
      canonicalSize: { cols: 100, rows: 30 },
    })

    oldResizeAcknowledged.resolve(true)
    await expect(takeover).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(manager.getSessionSummaryForUser(USER_ID, created.terminalRuntimeSessionId)).toMatchObject({
      terminalRuntimeGeneration: created.terminalRuntimeGeneration + 1,
      controller: { clientId: CLIENT_ID },
      canonicalSize: { cols: 100, rows: 30 },
    })
    expect(onIdentity).not.toHaveBeenCalled()
  })

  test('publishes acknowledged native geometry when controller presence expires during resize', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onlineClients = new Set([CLIENT_ID])
    const onIdentity = vi.fn()
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { onOutput: vi.fn(), onExit: vi.fn(), onIdentity },
      (_userId, clientId) => onlineClients.has(clientId),
      createWorkspaceRuntimeRetentionHost(),
    )
    const created = await createSession(manager, supervisor)
    const nativeResize = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockImplementationOnce(async () => await nativeResize.promise)

    const resize = manager.resizeSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledOnce())
    onlineClients.delete(CLIENT_ID)
    manager.handleClientPresenceChanged(USER_ID, CLIENT_ID, true)
    nativeResize.resolve(true)

    await expect(resize).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(manager.getSessionSummaryForUser(USER_ID, created.terminalRuntimeSessionId)).toMatchObject({
      controller: null,
      canonicalSize: { cols: 100, rows: 30 },
    })
    expect(onIdentity).toHaveBeenLastCalledWith(
      USER_ID,
      expect.objectContaining({ controller: null, canonicalSize: { cols: 100, rows: 30 } }),
    )
  })

  test('publishes acknowledged geometry and rejects only the unavailable recovery snapshot', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onIdentity })
    const created = await createSession(manager, supervisor)
    onIdentity.mockClear()
    vi.spyOn(SerializeAddon.prototype, 'serialize').mockImplementationOnce(() => {
      throw new Error('serializer unavailable')
    })

    await expect(
      manager.attachSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration,
        112,
        37,
        CLIENT_ID,
      ),
    ).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(onIdentity).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ canonicalSize: { cols: 112, rows: 37 } }),
    )

    await expect(
      manager.attachSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration,
        112,
        37,
        CLIENT_ID,
      ),
    ).resolves.toMatchObject({ ok: true, frame: 'snapshot', canonicalSize: { cols: 112, rows: 37 } })
  })

  test('rejects an acknowledged resize after close admission while retaining the physical geometry fact', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onIdentity })
    const created = await createSession(manager, supervisor)
    onIdentity.mockClear()
    const resizeAcknowledged = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockReturnValueOnce(resizeAcknowledged.promise)
    const killAcknowledged = Promise.withResolvers<void>()
    supervisor.killAndWait = vi.fn(async () => await killAcknowledged.promise)

    const resize = manager.resizeSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      112,
      37,
      CLIENT_ID,
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledOnce())
    resizeAcknowledged.resolve(true)
    const close = manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)

    await expect(resize).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(onIdentity).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ canonicalSize: { cols: 112, rows: 37 } }),
    )
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions[0]).toMatchObject({
      controller: { clientId: CLIENT_ID },
      canonicalSize: { cols: 112, rows: 37 },
    })

    killAcknowledged.resolve()
    await expect(close).resolves.toMatchObject({ kind: 'closed' })
  })

  test('does not commit takeover control after close admission', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const created = await createSession(manager, supervisor)
    const viewerClientId = 'client-takeover-closing'
    await expect(
      manager.attachSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration,
        80,
        24,
        viewerClientId,
      ),
    ).resolves.toMatchObject({ ok: true, frame: 'snapshot' })
    const resizeAcknowledged = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockReturnValueOnce(resizeAcknowledged.promise)
    const killAcknowledged = Promise.withResolvers<void>()
    supervisor.killAndWait = vi.fn(async () => await killAcknowledged.promise)

    const takeover = manager.takeoverSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      viewerClientId,
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledOnce())
    resizeAcknowledged.resolve(true)
    const close = manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)

    await expect(takeover).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions[0]).toMatchObject({
      controller: { clientId: CLIENT_ID },
      canonicalSize: { cols: 120, rows: 40 },
    })

    killAcknowledged.resolve()
    await expect(close).resolves.toMatchObject({ kind: 'closed' })
  })

  test('does not resurrect a client that expires while takeover geometry is committing', async () => {
    const supervisor = createDeferredPtySupervisor()
    const viewerClientId = 'client-takeover-expiring'
    const onlineClients = new Set([CLIENT_ID, viewerClientId])
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { onOutput: vi.fn(), onExit: vi.fn() },
      (_userId, clientId) => onlineClients.has(clientId),
      createWorkspaceRuntimeRetentionHost(),
    )
    const created = await createSession(manager, supervisor)
    await manager.attachSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      viewerClientId,
    )
    const resizeAcknowledged = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockReturnValueOnce(resizeAcknowledged.promise)

    const takeover = manager.takeoverSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      viewerClientId,
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledOnce())
    onlineClients.delete(viewerClientId)
    manager.expireClientAttachments(USER_ID, viewerClientId)
    resizeAcknowledged.resolve(true)

    await expect(takeover).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions[0]).toMatchObject({
      controller: { clientId: CLIENT_ID },
      canonicalSize: { cols: 100, rows: 30 },
    })
    await expect(
      manager.takeoverSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration,
        100,
        30,
        viewerClientId,
      ),
    ).resolves.toEqual({ ok: false, message: 'error.invalid-arguments' })
  })

  test('publishes acknowledged native geometry without granting takeover after the requester goes offline', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onlineClients = new Set([CLIENT_ID, 'client-b'])
    const onIdentity = vi.fn()
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { onOutput: vi.fn(), onExit: vi.fn(), onIdentity },
      (_userId, clientId) => onlineClients.has(clientId),
      createWorkspaceRuntimeRetentionHost(),
    )
    const created = await createSession(manager, supervisor)
    await manager.attachSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      80,
      24,
      'client-b',
    )
    const nativeResize = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockImplementationOnce(async () => await nativeResize.promise)
    onIdentity.mockClear()

    const takeover = manager.takeoverSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      'client-b',
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledOnce())
    onlineClients.delete('client-b')
    manager.handleClientPresenceChanged(USER_ID, 'client-b', true)
    nativeResize.resolve(true)

    await expect(takeover).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(manager.getSessionSummaryForUser(USER_ID, created.terminalRuntimeSessionId)).toMatchObject({
      controller: { clientId: CLIENT_ID },
      canonicalSize: { cols: 120, rows: 40 },
    })
    expect(onIdentity).toHaveBeenLastCalledWith(
      USER_ID,
      expect.objectContaining({
        controller: expect.objectContaining({ clientId: CLIENT_ID }),
        canonicalSize: { cols: 120, rows: 40 },
      }),
    )
  })

  test('rejects an existing admission after the PTY exits during placement preparation', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onIdentity })
    await createSession(manager, supervisor)

    const admission = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
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

  test('detaches and disposes a naturally exited session when lifecycle publication throws', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onLifecycle = vi.fn()
    const onSessionClosed = vi.fn()
    const onOutput = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onLifecycle, onSessionClosed, onOutput })
    const created = await createSession(manager, supervisor)
    onLifecycle.mockImplementation(() => {
      throw new Error('publication failed')
    })
    onOutput.mockClear()

    expect(() => supervisor.emitExit('pty_initial_123456')).not.toThrow()

    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(onSessionClosed).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId, phase: 'closed' }),
      'session',
    )
    supervisor.emitData('pty_initial_123456', 'late output')
    expect(onOutput).not.toHaveBeenCalled()
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
    const manager = createAlwaysOnlineManager(supervisor, { onIdentity })
    const created = await createSession(manager, supervisor)
    const admission = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
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
    await expect(manager.requestSessionRetirement(created.terminalRuntimeSessionId)).resolves.toBe(false)
  })

  test('retains the exact workspace runtime until the terminal session is detached', async () => {
    const supervisor = createDeferredPtySupervisor()
    const release = vi.fn()
    const retentions = {
      retain: vi.fn(() => ({ release })),
    }
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { onOutput: vi.fn(), onExit: vi.fn() },
      () => true,
      retentions,
    )
    const created = await createSession(manager, supervisor)

    expect(retentions.retain).toHaveBeenCalledOnce()
    expect(retentions.retain).toHaveBeenCalledWith(
      USER_ID,
      WORKSPACE_ID,
      WORKTREE_TARGET.workspaceRuntimeId,
      created.terminalRuntimeSessionId,
    )
    expect(release).not.toHaveBeenCalled()

    await expect(manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)).resolves.toMatchObject({
      kind: 'closed',
    })
    expect(release).toHaveBeenCalledOnce()
  })

  test('releases the admission reservation when runtime retention rejects a stale generation', () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = new TerminalSessionManager<string>(supervisor, { onOutput: vi.fn(), onExit: vi.fn() }, () => true, {
      retain: vi.fn(() => {
        throw new Error('error.workspace-runtime-stale')
      }),
    })
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    }
    const prepared = manager.prepareSession(input)
    if (!prepared.ok || prepared.admission.kind !== 'prepared') throw new Error('expected prepared admission')

    expect(() =>
      prepared.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
      }),
    ).toThrow('error.workspace-runtime-stale')
    prepared.admission.abort()

    const retried = manager.prepareSession(input)
    expect(retried).toMatchObject({ ok: true, admission: { kind: 'prepared' } })
    if (retried.ok && retried.admission.kind === 'prepared') retried.admission.abort()
  })

  test('prepares without spawning, then starts at fitted geometry and snapshots only later attaches', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onOutput = vi.fn()
    const onSessionsProjectionChanged = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onOutput, onSessionsProjectionChanged })
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

    const freshAttach = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 0, 123, 41, CLIENT_ID)
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
    const freshSpawn = ptySpawnSuccess('pty_fresh_stream_123456')
    supervisor.emitData('pty_fresh_stream_123456', 'early prompt')
    supervisor.spawns.shift()?.(freshSpawn)
    await expect(freshAttach).resolves.toMatchObject({
      ok: true,
      frame: 'stream',
      terminalRuntimeGeneration: 1,
      terminalProjectionEffect: { kind: 'delta', revision: 2 },
      canonicalSize: { cols: 123, rows: 41 },
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
    expect(onOutput).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        terminalRuntimeGeneration: 1,
        data: 'early prompt',
        seq: 1,
      }),
    )

    await expect(
      manager.writeSession(USER_ID, prepared.terminalRuntimeSessionId, 0, 'stale input', CLIENT_ID),
    ).resolves.toEqual({ status: 'rejected' })
    await expect(
      manager.writeSession(USER_ID, prepared.terminalRuntimeSessionId, 1, 'input before output', CLIENT_ID),
    ).resolves.toEqual({ status: 'accepted' })

    supervisor.emitData('pty_fresh_stream_123456', 'prompt')
    expect(onOutput).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ data: 'prompt', seq: 2 }))
    const recoveryAttach = await manager.attachSession(
      USER_ID,
      prepared.terminalRuntimeSessionId,
      1,
      123,
      41,
      CLIENT_ID,
    )
    expect(recoveryAttach).toMatchObject({
      ok: true,
      frame: 'snapshot',
      snapshot: 'early promptprompt',
      snapshotSeq: 2,
    })
  })

  test('does not commit a fresh binding whose native spawn resolves after close admission', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onIdentity })
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    })
    if (!prepared.ok) throw new Error(prepared.message)
    prepared.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })
    prepared.admission.publishCommittedEffects()

    const attach = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 0, 100, 30, CLIENT_ID)
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_fresh_close_race_123'))
    const close = manager.closeSessionForUserOutcome(USER_ID, prepared.terminalRuntimeSessionId)

    await expect(attach).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(close).resolves.toMatchObject({ kind: 'closed' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(onIdentity).not.toHaveBeenCalled()
  })

  test('publishes a failed candidate retirement as a fresh attach error and drains it before retry', async () => {
    const supervisor = createDeferredPtySupervisor()
    const retryKillAcknowledged = Promise.withResolvers<void>()
    const offlineClients = new Set<string>()
    supervisor.killAndWait = vi
      .fn<(handle: PtyHandle) => Promise<void>>()
      .mockRejectedValueOnce(new Error('PTY close timed out'))
      .mockImplementationOnce(async () => await retryKillAcknowledged.promise)
    const manager = createManagerWithPresence(supervisor, {}, (clientId) => !offlineClients.has(clientId))
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    })
    if (!prepared.ok) throw new Error(prepared.message)
    prepared.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })
    prepared.admission.publishCommittedEffects()

    const first = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 0, 100, 30, CLIENT_ID)
    offlineClients.add(CLIENT_ID)
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_rejected_fresh_candidate_123'))

    await expect(first).resolves.toEqual({ ok: false, message: 'PTY close timed out' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([
      expect.objectContaining({
        terminalRuntimeGeneration: 0,
        phase: 'error',
        message: 'PTY close timed out',
        canonicalSize: null,
      }),
    ])

    const retry = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 0, 120, 40, 'client-retry')
    await vi.waitFor(() => expect(supervisor.killAndWait).toHaveBeenCalledTimes(2))
    expect(supervisor.spawn).toHaveBeenCalledOnce()

    retryKillAcknowledged.resolve()
    await vi.waitFor(() => expect(supervisor.spawn).toHaveBeenCalledTimes(2))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_fresh_after_retirement_123'))
    await expect(retry).resolves.toMatchObject({
      ok: true,
      frame: 'stream',
      terminalRuntimeGeneration: 1,
      canonicalSize: { cols: 120, rows: 40 },
    })
  })

  test('gives a concurrent later attach a snapshot after the fresh spawn completes', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    })
    if (!prepared.ok) throw new Error(prepared.message)
    prepared.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })
    prepared.admission.publishCommittedEffects()

    const first = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 0, 100, 30, CLIENT_ID)
    const second = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 0, 120, 40, 'client-test-2')
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
    const manager = createAlwaysOnlineManager(supervisor)
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    })
    if (!prepared.ok) throw new Error(prepared.message)

    expect(manager.primaryTerminalSessionIdForFilesystemTarget(USER_ID, SCOPE, WORKSPACE_ID)).toBeNull()

    await expect(manager.closeSessionForUserOutcome(USER_ID, prepared.terminalRuntimeSessionId)).resolves.toEqual({
      kind: 'already-closed',
    })
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
    const manager = createAlwaysOnlineManager(supervisor, { onSessionsProjectionChanged })

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
    const manager = createAlwaysOnlineManager(supervisor)

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
    const close = manager.closeSessionForUserOutcome(USER_ID, openingSession!.terminalRuntimeSessionId)

    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_late_spawn_123456'))

    await expect(close).resolves.toMatchObject({ kind: 'closed' })
    await expect(pending).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(manager.primaryTerminalSessionIdForFilesystemTarget(USER_ID, SCOPE, WORKSPACE_ID)).toBeNull()
    expect(supervisor.killed).toEqual(['pty_late_spawn_123456'])
  })

  test('reports scope close reason for repo cleanup', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onSessionClosed = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onSessionClosed })
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

  test('invalidates a workspace runtime session and disposes its binding at the same authority boundary', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onSessionClosed = vi.fn()
    const release = vi.fn()
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { onOutput: vi.fn(), onExit: vi.fn(), onSessionClosed },
      () => true,
      { retain: vi.fn(() => ({ release })) },
    )
    const created = await createSession(manager, supervisor)
    const invalidation = manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)

    expect(invalidation.removedSessions).toEqual([
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
    ])
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(onSessionClosed).not.toHaveBeenCalled()
    expect(supervisor.killed).toEqual(['pty_initial_123456'])
    expect(release).toHaveBeenCalledOnce()

    invalidation.publishEffects()
    invalidation.publishEffects()

    expect(onSessionClosed).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
      'scope',
    )
    manager.forceShutdown()
    expect(release).toHaveBeenCalledOnce()
  })

  test('revokes PTY mutation and output ownership at the authoritative invalidation boundary', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const onOutput = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onIdentity, onOutput })
    const created = await createSession(manager, supervisor)
    const nativeResize = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockImplementationOnce(async () => await nativeResize.promise)
    onIdentity.mockClear()
    onOutput.mockClear()

    const resize = manager.resizeSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledOnce())

    const invalidation = manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)
    supervisor.emitData('pty_initial_123456', 'late output')
    nativeResize.resolve(true)

    await expect(resize).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(onIdentity).not.toHaveBeenCalled()
    expect(onOutput).not.toHaveBeenCalled()

    expect(supervisor.killed).toContain('pty_initial_123456')
    invalidation.publishEffects()
  })

  test('keeps a committed invalidation when publication effects fail', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor, {
      onSessionClosed: vi.fn(() => {
        throw new Error('publication failed')
      }),
    })
    await createSession(manager, supervisor)

    const invalidation = manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)

    expect(() => invalidation.publishEffects()).not.toThrow()
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
  })

  test('retires an invalidated PTY through the acknowledged boundary and releases its shutdown owner', async () => {
    const supervisor = createDeferredPtySupervisor()
    const kill = vi.fn()
    const killAndWait = vi.fn(async () => undefined)
    supervisor.kill = kill
    supervisor.killAndWait = killAndWait
    const manager = createAlwaysOnlineManager(supervisor)
    await createSession(manager, supervisor)

    const invalidation = manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)
    invalidation.publishEffects()
    await vi.waitFor(() => expect(killAndWait).toHaveBeenCalledOnce())
    await Promise.resolve()
    await Promise.resolve()
    manager.forceShutdown()

    expect(killAndWait).toHaveBeenCalledWith(createPtyHandle('pty_initial_123456'))
    expect(kill).not.toHaveBeenCalled()
  })

  test('transfers a failed invalidation retirement to supervisor shutdown without retrying', async () => {
    const supervisor = createDeferredPtySupervisor()
    const eventualExit = Promise.withResolvers<void>()
    const killAndWait = vi.fn(async () => {
      throw new Error('PTY close timed out')
    })
    const kill = vi.fn()
    supervisor.waitForExit = vi.fn(async () => await eventualExit.promise)
    supervisor.killAndWait = killAndWait
    supervisor.kill = kill
    const manager = createAlwaysOnlineManager(supervisor)
    await createSession(manager, supervisor)

    manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)
    await vi.waitFor(() => expect(killAndWait).toHaveBeenCalledOnce())
    await Promise.resolve()
    manager.forceShutdown()

    expect(kill).not.toHaveBeenCalled()
    eventualExit.resolve()
  })

  test('keeps invalidation retirement ownership until a late native spawn exits', async () => {
    const supervisor = createDeferredPtySupervisor()
    const termination = Promise.withResolvers<void>()
    const killAndWait = vi.fn(async () => await termination.promise)
    const kill = vi.fn()
    supervisor.waitForExit = vi.fn(async () => await termination.promise)
    supervisor.killAndWait = killAndWait
    supervisor.kill = kill
    const manager = createAlwaysOnlineManager(supervisor)
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: WORKTREE_PATH,
    })
    if (!prepared.ok) throw new Error(prepared.message)
    prepared.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })
    prepared.admission.publishCommittedEffects()
    const attach = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 0, 100, 30, CLIENT_ID)
    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))

    manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_invalidated_late_spawn_123'))
    await vi.waitFor(() => expect(killAndWait).toHaveBeenCalledOnce())
    expect(kill).not.toHaveBeenCalled()
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])

    termination.resolve()
    await expect(attach).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await Promise.resolve()
    manager.forceShutdown()
    expect(killAndWait).toHaveBeenCalledOnce()
    expect(kill).not.toHaveBeenCalled()
  })

  test('reports detached-user close reason for detached TTL cleanup', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onSessionClosed = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onSessionClosed })
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
    const manager = createAlwaysOnlineManager(supervisor)
    const created = await createSession(manager, supervisor)

    const firstRestart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )
    const secondRestart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      CLIENT_ID,
    )

    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_restart_two_123'))

    await expect(firstRestart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(secondRestart).resolves.toMatchObject({
      ok: true,
      frame: 'stream',
      terminalRuntimeSessionId: created.terminalRuntimeSessionId,
      canonicalSize: { cols: 120, rows: 40 },
    })

    expect(supervisor.killed).toEqual(['pty_initial_123456'])
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
    ])

    await expect(manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)).resolves.toMatchObject({
      kind: 'closed',
    })
    expect(supervisor.killed).toEqual(['pty_initial_123456', 'pty_restart_two_123'])
  })

  test('publishes only the latest restart failure when an older restart is superseded', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const created = await createSession(manager, supervisor)

    const firstRestart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )
    const secondRestart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      CLIENT_ID,
    )

    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.({ ok: false, message: 'new restart failed' })

    await expect(firstRestart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(secondRestart).resolves.toEqual({ ok: false, message: 'new restart failed' })

    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: created.terminalRuntimeSessionId,
        terminalRuntimeGeneration: created.terminalRuntimeGeneration,
        phase: 'error',
        message: 'new restart failed',
        canonicalSize: { cols: 80, rows: 24 },
      }),
    ])
  })

  test('does not publish a replacement after the requesting controller expires during spawn', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const created = await createSession(manager, supervisor)

    const restart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      CLIENT_ID,
    )
    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))

    manager.expireClientAttachments(USER_ID, CLIENT_ID)
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_expired_restart_123'))

    await expect(restart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: created.terminalRuntimeSessionId,
        terminalRuntimeGeneration: created.terminalRuntimeGeneration,
        canonicalSize: { cols: 80, rows: 24 },
      }),
    ])
    expect(supervisor.killed).toEqual(['pty_initial_123456', 'pty_expired_restart_123'])
  })

  test('does not adopt a replacement PTY whose spawn resolves after close admission', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const created = await createSession(manager, supervisor)

    const restart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      CLIENT_ID,
    )
    await vi.waitFor(() => expect(supervisor.spawn).toHaveBeenCalledTimes(2))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_restart_close_race_123'))
    const close = manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)

    await expect(restart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(close).resolves.toMatchObject({ kind: 'closed' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(supervisor.killed).toContain('pty_restart_close_race_123')
  })

  test('rejects an attach fenced to the retired generation after a superseding restart', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const created = await createSession(manager, supervisor)

    const firstRestart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )
    const attach = manager.attachSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )
    const secondRestart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      CLIENT_ID,
    )

    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_restart_two_789'))

    await expect(firstRestart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(secondRestart).resolves.toMatchObject({
      ok: true,
      frame: 'stream',
      terminalRuntimeSessionId: created.terminalRuntimeSessionId,
      canonicalSize: { cols: 120, rows: 40 },
    })
    await expect(attach).resolves.toEqual({ ok: false, message: 'error.unavailable' })
  })
})

describe('TerminalSessionManager physical worktree quiescence', () => {
  test.each(['resolve', 'reject'] as const)(
    'reports an already-closed outcome when Git cleanup removes authority before PTY disposal %s',
    async (disposalResult) => {
      const supervisor = createDeferredPtySupervisor()
      let resolveDirectClose!: () => void
      let rejectDirectClose!: (error: Error) => void
      const directCloseDisposal = new Promise<void>((resolve, reject) => {
        resolveDirectClose = resolve
        rejectDirectClose = reject
      })
      supervisor.killAndWait = vi
        .fn()
        .mockImplementationOnce(async () => await directCloseDisposal)
        .mockResolvedValue(undefined)
      const onLifecycle = vi.fn()
      const manager = createAlwaysOnlineManager(supervisor, { onLifecycle })
      const pending = ensureSession(manager, {
        userId: USER_ID,
        target: WORKTREE_TARGET,
        terminalSessionId: TERMINAL_SESSION_ID,
        cwd: WORKTREE_PATH,
        cols: 80,
        rows: 24,
        clientId: CLIENT_ID,
      })
      supervisor.spawns.shift()?.(ptySpawnSuccess('pty_cleanup_close_race_123'))
      const created = await pending
      if (!created.ok) throw new Error(created.message)

      const close = manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)
      await vi.waitFor(() => expect(supervisor.killAndWait).toHaveBeenCalledOnce())

      const cleanup = manager.commitGitSessionInvalidation(USER_ID, SCOPE)
      expect(cleanup.removedCount).toBe(1)
      cleanup.publishEffects()
      onLifecycle.mockClear()
      if (disposalResult === 'resolve') resolveDirectClose()
      else rejectDirectClose(new Error('PTY close failed after authority removal'))

      await expect(close).resolves.toEqual({ kind: 'already-closed' })
      await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
      expect(onLifecycle).not.toHaveBeenCalled()
    },
  )

  test('keeps the session authoritative when PTY exit re-enters close before kill acknowledgement', async () => {
    const supervisor = createDeferredPtySupervisor()
    let acknowledgeKill!: () => void
    const killAcknowledged = new Promise<void>((resolve) => {
      acknowledgeKill = resolve
    })
    supervisor.killAndWait = vi.fn(async (handle) => {
      supervisor.emitExit(handle.ptySessionId)
      await killAcknowledged
    })
    const onSessionClosed = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onSessionClosed })
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

    const close = manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)
    await Promise.resolve()
    await Promise.resolve()
    expect(onSessionClosed).not.toHaveBeenCalled()
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toHaveLength(1)

    acknowledgeKill()
    await expect(close).resolves.toMatchObject({ kind: 'closed' })
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
    const manager = createAlwaysOnlineManager(supervisor, { onSessionClosed })
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
    const directClose = manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)
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
    await expect(directClose).resolves.toEqual({ kind: 'already-closed' })
    expect(onSessionClosed).toHaveBeenCalledOnce()
  })

  test('quiesces a physical worktree opened through a different repository entry', async () => {
    const supervisor = createDeferredPtySupervisor()
    supervisor.killAndWait = vi.fn(async () => {})
    const manager = createAlwaysOnlineManager(supervisor)
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
    const manager = createAlwaysOnlineManager(supervisor)
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
    const manager = createAlwaysOnlineManager(supervisor)
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
    const manager = createAlwaysOnlineManager(supervisor)
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
    const manager = createAlwaysOnlineManager(supervisor)
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
    const manager = createAlwaysOnlineManager(supervisor)
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

    const restart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      80,
      24,
      CLIENT_ID,
    )
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
    const manager = createAlwaysOnlineManager(supervisor)
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

    await expect(
      manager.restartSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration,
        80,
        24,
        CLIENT_ID,
      ),
    ).resolves.toEqual({ ok: false, message: 'PTY close timed out' })
    expect(supervisor.spawns).toEqual([])
    expect(killAndWait.mock.calls.map(([handle]) => handle.ptySessionId)).toEqual([retiredPtySessionId])

    retiredExited = true
    supervisor.emitExit(retiredPtySessionId)
    const retry = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      80,
      24,
      CLIENT_ID,
    )
    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess(replacementPtySessionId))
    await expect(retry).resolves.toMatchObject({ ok: true })
    await expect(manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)).resolves.toMatchObject({
      kind: 'closed',
    })
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
    const manager = createAlwaysOnlineManager(supervisor)
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
    expect(beforeBinding.sessions[0]).toMatchObject({
      terminalRuntimeGeneration: 0,
      processName: 'terminal',
      canonicalSize: null,
    })

    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_default_process_123'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)
    const afterBinding = manager.terminalSessionsSnapshotForUser(USER_ID, scope)

    expect(afterBinding.revision).toBe(beforeBinding.revision + 1)
    expect(afterBinding.sessions[0]).toMatchObject({
      terminalRuntimeGeneration: 1,
      processName: 'zsh',
      phase: 'open',
    })
  })

  test('does not advance the projection revision for incremental runtime details', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
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
        canonicalSize: { cols: 80, rows: 24 },
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
    await expect(
      manager.resizeSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration + 1,
        100,
        30,
        CLIENT_ID,
      ),
    ).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, scope).sessions[0]).toMatchObject({
      canonicalSize: { cols: 80, rows: 24 },
    })
    await expect(
      manager.resizeSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration,
        100,
        30,
        CLIENT_ID,
      ),
    ).resolves.toEqual({
      ok: true,
      terminalRuntimeSessionId: created.terminalRuntimeSessionId,
      terminalRuntimeGeneration: created.terminalRuntimeGeneration,
      canonicalSize: { cols: 100, rows: 30 },
    })
    const resizedSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(resizedSnapshot.revision).toBe(beforeResize)
    expect(resizedSnapshot.sessions[0]).toMatchObject({ canonicalSize: { cols: 100, rows: 30 } })

    await expect(manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)).resolves.toMatchObject({
      kind: 'closed',
    })
    const closedSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(closedSnapshot.revision).toBe(resizedSnapshot.revision + 1)
    expect(closedSnapshot.sessions).toEqual([])
  })
})

describe('TerminalSessionManager runtime binding generations', () => {
  test('publishes the PTY binding generation on response frames and realtime events', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onOutput = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onOutput })
    const created = await createSession(manager, supervisor)
    expect(created.terminalRuntimeGeneration).toBe(1)

    supervisor.emitData('pty_initial_123456', 'first')
    expect(onOutput).toHaveBeenLastCalledWith(USER_ID, expect.objectContaining({ terminalRuntimeGeneration: 1 }))

    const restart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )
    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_generation_two_123'))
    await expect(restart).resolves.toMatchObject({ ok: true, frame: 'stream', terminalRuntimeGeneration: 2 })

    supervisor.emitData('pty_generation_two_123', 'second')
    expect(onOutput).toHaveBeenLastCalledWith(USER_ID, expect.objectContaining({ terminalRuntimeGeneration: 2 }))
  })
})
