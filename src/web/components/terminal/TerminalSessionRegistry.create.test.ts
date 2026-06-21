// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createMock: vi.fn(),
  closeMock: vi.fn(),
  openViewMock: vi.fn(),
  closeViewMock: vi.fn(),
  reorderMock: vi.fn(),
  proposeTerminalGeometryMock: vi.fn(() => ({ cols: 101, rows: 31 })),
  preloadTerminalFontMock: vi.fn(async () => {}),
  attachmentIdMock: vi.fn(() => 'attachment_local'),
}))

vi.mock('#/web/terminal.ts', () => ({
  terminalBridge: {
    create: mocks.createMock,
    close: mocks.closeMock,
    openView: mocks.openViewMock,
    closeView: mocks.closeViewMock,
    reorderViews: mocks.reorderMock,
    setBadge: vi.fn(),
  },
}))

vi.mock('#/web/renderer-terminal-bridge.ts', () => ({
  readOrCreateWebTerminalAttachmentId: mocks.attachmentIdMock,
}))

vi.mock('#/web/components/terminal/terminal-geometry.ts', () => ({
  DEFAULT_TERMINAL_COLS: 80,
  DEFAULT_TERMINAL_ROWS: 24,
  preloadTerminalFont: mocks.preloadTerminalFontMock,
  proposeTerminalGeometry: mocks.proposeTerminalGeometryMock,
}))

vi.mock('#/web/components/terminal/ManagedTerminalSession.ts', () => {
  class MockManagedTerminalSession {
    descriptor: any
    private sessionId: string | null = null
    private snapshotState: any = { phase: 'opening', message: null, processName: 'terminal', canonicalTitle: null }
    private serializeValue = ''

    constructor(descriptor: any) {
      this.descriptor = descriptor
    }

    updateDescriptor(descriptor: any): void {
      this.descriptor = descriptor
    }

    attach(): void {}
    detach(): void {}
    restart(): void {}
    dispose(): void {}
    isTerminalFocusTarget(): boolean {
      return false
    }
    findNext() {
      return { resultIndex: -1, resultCount: 0, found: false }
    }
    findPrevious() {
      return { resultIndex: -1, resultCount: 0, found: false }
    }
    clearSearch(): void {}
    scrollToBottom(): void {}
    scrollLines(): void {}
    writeInput(): void {}
    takeover(): Promise<boolean> {
      return Promise.resolve(true)
    }
    serialize(): string {
      return this.serializeValue
    }
    handleOutput(): void {}
    handleServerTitle(): void {}
    handleExit(): boolean {
      return false
    }
    handleOwnership(): void {}
    currentSessionId(): string | null {
      return this.sessionId
    }
    snapshot() {
      return this.snapshotState
    }
    hydrate(input: any): void {
      this.sessionId = input.sessionId
      this.serializeValue = input.snapshot ?? this.serializeValue
      this.snapshotState = {
        phase: 'open',
        message: null,
        processName: input.processName,
        canonicalTitle: input.canonicalTitle,
        attachment: {
          role: input.role,
          controllerStatus: input.controllerStatus,
          active: input.role === 'controller',
          canTakeover: input.role !== 'controller',
          canonicalCols: input.canonicalCols,
          canonicalRows: input.canonicalRows,
        },
      }
    }
  }

  return { ManagedTerminalSession: MockManagedTerminalSession }
})

import {
  TerminalSessionRegistry,
  setTerminalSessionRegistryForTests,
} from '#/web/components/terminal/TerminalSessionRegistry.ts'

const REPO_ROOT = '/repo'
const WORKTREE_PATH = '/repo'
const BRANCH = 'main'
const WORKTREE_KEY = `${REPO_ROOT}\0${WORKTREE_PATH}`

function makeRepoIndex() {
  return {
    [REPO_ROOT]: {
      instanceToken: 1,
      branchByWorktreePath: { [WORKTREE_PATH]: BRANCH },
    },
  }
}

function makeCreateResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true as const,
    action: 'created' as const,
    key: `${REPO_ROOT}\0${WORKTREE_PATH}\0terminal-1`,
    sessionId: 'session-1',
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open' as const,
    message: null,
    snapshot: '',
    snapshotSeq: 0,
    controller: { attachmentId: 'attachment_local', status: 'connected' as const },
    canonicalCols: 101,
    canonicalRows: 31,
    sessions: [
      {
        sessionId: 'session-1',
        key: `${REPO_ROOT}\0${WORKTREE_PATH}\0terminal-1`,
        cwd: WORKTREE_PATH,
        controller: { attachmentId: 'attachment_local', status: 'connected' as const },
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open' as const,
        message: null,
        cols: 101,
        rows: 31,
        displayOrder: 0,
      },
    ],
    ...overrides,
  }
}

describe('TerminalSessionRegistry create flow', () => {
  let registry: TerminalSessionRegistry

  beforeEach(() => {
    mocks.createMock.mockReset()
    mocks.createMock.mockResolvedValue(makeCreateResult())
    mocks.closeMock.mockReset()
    mocks.closeMock.mockResolvedValue(true)
    mocks.openViewMock.mockReset()
    mocks.openViewMock.mockResolvedValue(true)
    mocks.closeViewMock.mockReset()
    mocks.closeViewMock.mockResolvedValue(true)
    mocks.reorderMock.mockReset()
    mocks.reorderMock.mockResolvedValue(true)
    mocks.proposeTerminalGeometryMock.mockClear()
    mocks.preloadTerminalFontMock.mockClear()
    mocks.attachmentIdMock.mockClear()
    registry = new TerminalSessionRegistry(() => REPO_ROOT)
    registry.setRepoIndex(makeRepoIndex())
    setTerminalSessionRegistryForTests(registry)
  })

  afterEach(() => {
    registry.destroy()
    setTerminalSessionRegistryForTests(null)
    document.body.innerHTML = ''
  })

  test('creates a terminal with the registered host geometry', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    registry.registerHost(WORKTREE_KEY, host)

    await registry.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    expect(mocks.preloadTerminalFontMock).toHaveBeenCalled()
    expect(mocks.proposeTerminalGeometryMock).toHaveBeenCalledWith(host)
    expect(mocks.createMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
      kind: 'primary',
      cols: 101,
      rows: 31,
      attachmentId: 'attachment_local',
    })
  })

  test('waits for host registration before creating when no geometry is available yet', async () => {
    const pending = registry.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    expect(mocks.createMock).not.toHaveBeenCalled()

    const host = document.createElement('div')
    document.body.appendChild(host)
    registry.registerHost(WORKTREE_KEY, host)

    await expect(pending).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0terminal-1`)
    expect(mocks.createMock).toHaveBeenCalledTimes(1)
    expect(mocks.createMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
      kind: 'primary',
      cols: 101,
      rows: 31,
      attachmentId: 'attachment_local',
    })
  })

  test('durable close: awaits an in-flight close for the same worktree before creating', async () => {
    // Regression for the duplicate `Restored session:` bug: the prior
    // dispose path was fire-and-forget, so a create could race the
    // close and reattach to the orphan. The registry's durable-close
    // queue guarantees create waits for the close to settle.
    const host = document.createElement('div')
    document.body.appendChild(host)
    registry.registerHost(WORKTREE_KEY, host)

    // Order closeMock to record its call order relative to createMock.
    const callOrder: string[] = []
    mocks.closeMock.mockImplementation(async () => {
      callOrder.push('close')
      return true
    })
    mocks.createMock.mockImplementation(async () => {
      callOrder.push('create')
      return makeCreateResult()
    })

    // Enqueue a durable close and DO NOT await it. The next
    // createTerminal must wait for the close to settle before
    // issuing its own create call.
    const closePromise = registry.enqueueDurableClose({
      sessionId: 'session-stale',
      worktreeTerminalKey: WORKTREE_KEY,
    })

    // Start the create before the close settles. The promise must
    // resolve only after both have run, in the right order.
    const createPromise = registry.createTerminal({
      repoRoot: REPO_ROOT,
      branch: BRANCH,
      worktreePath: WORKTREE_PATH,
    })

    // Both promises settle eventually.
    await expect(closePromise).resolves.toBeUndefined()
    await expect(createPromise).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0terminal-1`)

    // Close is awaited before create. Without the durable-close
    // guard, create would resolve first because the close promise
    // was launched with `void`.
    expect(callOrder).toEqual(['close', 'create'])

    // The pending entry is cleaned up after the close settles.
    expect((registry as any).pendingCloseBySessionId.size).toBe(0)
  })

  test('durable close: failures do not block the next create', async () => {
    // The flush-and-proceed seam: a stuck close (e.g., socket
    // already closing) must not strand the user. The create still
    // runs; the failure is already logged inside performDurableClose.
    const host = document.createElement('div')
    document.body.appendChild(host)
    registry.registerHost(WORKTREE_KEY, host)

    mocks.closeMock.mockRejectedValueOnce(new Error('Terminal socket closed'))

    const closePromise = registry.enqueueDurableClose({
      sessionId: 'session-stale',
      worktreeTerminalKey: WORKTREE_KEY,
    })

    await expect(closePromise).rejects.toThrow('Terminal socket closed')
    expect((registry as any).pendingCloseBySessionId.size).toBe(0)

    // The next create proceeds normally.
    await expect(
      registry.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH }),
    ).resolves.toBe(`${REPO_ROOT}\0${WORKTREE_PATH}\0terminal-1`)
    expect(mocks.createMock).toHaveBeenCalledTimes(1)
  })

  test('durable close: deduplicates concurrent enqueues for the same session', async () => {
    // The catalog may surface a session-closed event AND a parallel
    // dispose() call for the same sessionId. The first call owns the
    // request; the second observes the same outcome.
    let resolveClose!: (value: boolean) => void
    mocks.closeMock.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveClose = resolve
      }),
    )

    const first = registry.enqueueDurableClose({
      sessionId: 'session-stale',
      worktreeTerminalKey: WORKTREE_KEY,
    })
    const second = registry.enqueueDurableClose({
      sessionId: 'session-stale',
      worktreeTerminalKey: WORKTREE_KEY,
    })

    // Only one close call was dispatched.
    expect(mocks.closeMock).toHaveBeenCalledTimes(1)
    expect(mocks.closeMock).toHaveBeenCalledWith({ sessionId: 'session-stale' })

    resolveClose(true)
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
  })

  test('durable close: destroys reject pending entries', async () => {
    // The pending-close map mirrors the pending-create map: on
    // destroy, every entry rejects so callers awaiting it can clean
    // up. The mock `close` is left hanging so the entry is still
    // pending when destroy runs.
    mocks.closeMock.mockReturnValueOnce(new Promise<boolean>(() => {}))

    const closePromise = registry.enqueueDurableClose({
      sessionId: 'session-stale',
      worktreeTerminalKey: WORKTREE_KEY,
    })

    expect((registry as any).pendingCloseBySessionId.size).toBe(1)
    registry.destroy()
    await expect(closePromise).rejects.toThrow('terminal registry destroyed')
    expect((registry as any).pendingCloseBySessionId.size).toBe(0)
  })

  test('durable close: handleSessionClosed drops the matching local session', async () => {
    // The server emits a session-closed broadcast when window A
    // closes a session. Sibling windows route the event into
    // handleSessionClosed to drop the local entry without a
    // full reconcile.
    const host = document.createElement('div')
    document.body.appendChild(host)
    registry.registerHost(WORKTREE_KEY, host)
    await registry.createTerminal({ repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH })

    expect(registry.worktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(1)

    registry.handleSessionClosed('session-1')

    // The local session is gone; the worktree snapshot is empty.
    expect(registry.worktreeSnapshot(WORKTREE_KEY).sessions.length).toBe(0)
  })

  test('opens a static workspace pane view through the workspace pane bridge action', async () => {
    registry.reconcileServerSessions(REPO_ROOT, makeCreateResult().sessions as any, 'attachment_local', new Map())

    await expect(registry.openWorkspacePaneView(WORKTREE_KEY, 'changes')).resolves.toBe(true)

    expect(mocks.openViewMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      worktreePath: WORKTREE_PATH,
      type: 'changes',
    })
    expect(mocks.reorderMock).not.toHaveBeenCalled()
    expect(registry.worktreeSnapshot(WORKTREE_KEY).workspacePaneViews.map((tab) => `${tab.type}:${tab.id}`)).toEqual([
      'terminal:/repo\0/repo\0terminal-1',
      'changes:changes',
    ])
  })

  test('opens status through the same static workspace pane bridge action', async () => {
    await expect(registry.openWorkspacePaneView(WORKTREE_KEY, 'status')).resolves.toBe(true)

    expect(mocks.openViewMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      worktreePath: WORKTREE_PATH,
      type: 'status',
    })
    expect(
      registry.worktreeSnapshot(WORKTREE_KEY).staticWorkspacePaneViews.map((tab) => `${tab.type}:${tab.id}`),
    ).toEqual(['status:status'])
  })

  test('rolls back optimistic static workspace pane view open when the bridge rejects it', async () => {
    mocks.openViewMock.mockResolvedValueOnce(false)

    await expect(registry.openWorkspacePaneView(WORKTREE_KEY, 'changes')).resolves.toBe(false)

    expect(registry.worktreeSnapshot(WORKTREE_KEY).staticWorkspacePaneViews).toEqual([])
  })

  test('closes a static workspace pane view through the workspace pane bridge action', async () => {
    await registry.openWorkspacePaneView(WORKTREE_KEY, 'changes')

    await expect(registry.closeWorkspacePaneView(WORKTREE_KEY, 'changes')).resolves.toBe(true)

    expect(mocks.closeViewMock).toHaveBeenCalledWith({
      repoRoot: REPO_ROOT,
      worktreePath: WORKTREE_PATH,
      type: 'changes',
    })
    expect(mocks.reorderMock).not.toHaveBeenCalled()
    expect(registry.worktreeSnapshot(WORKTREE_KEY).staticWorkspacePaneViews).toEqual([])
  })

  test('rejects reorder payloads that would create an unopened static workspace pane view', async () => {
    const terminalKey = `${REPO_ROOT}\0${WORKTREE_PATH}\0terminal-1`
    registry.reconcileServerSessions(REPO_ROOT, makeCreateResult().sessions as any, 'attachment_local', new Map())

    await expect(
      registry.reorderWorkspacePaneViews(WORKTREE_KEY, [
        { type: 'status', id: 'status' },
        { type: 'terminal', id: terminalKey },
      ]),
    ).resolves.toBe(false)

    expect(mocks.reorderMock).not.toHaveBeenCalled()
    expect(registry.worktreeSnapshot(WORKTREE_KEY).staticWorkspacePaneViews).toEqual([])
  })

  test('rolls back optimistic workspace pane view reorder when the bridge throws', async () => {
    const terminalKey = `${REPO_ROOT}\0${WORKTREE_PATH}\0terminal-1`
    registry.reconcileServerSessions(REPO_ROOT, makeCreateResult().sessions as any, 'attachment_local', new Map())
    await registry.openWorkspacePaneView(WORKTREE_KEY, 'changes')
    mocks.reorderMock.mockRejectedValueOnce(new Error('Terminal socket closed'))

    await expect(
      registry.reorderWorkspacePaneViews(WORKTREE_KEY, [
        { type: 'changes', id: 'changes' },
        { type: 'terminal', id: terminalKey },
      ]),
    ).resolves.toBe(false)

    expect(registry.worktreeSnapshot(WORKTREE_KEY).workspacePaneViews.map((tab) => `${tab.type}:${tab.id}`)).toEqual([
      `terminal:${terminalKey}`,
      'changes:changes',
    ])
  })
})
