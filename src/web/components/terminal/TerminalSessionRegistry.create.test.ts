// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createMock: vi.fn(),
  proposeTerminalGeometryMock: vi.fn(() => ({ cols: 101, rows: 31 })),
  preloadTerminalFontMock: vi.fn(async () => {}),
  attachmentIdMock: vi.fn(() => 'attachment_local'),
}))

vi.mock('#/web/terminal.ts', () => ({
  terminalBridge: {
    create: mocks.createMock,
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
    takeover(): void {}
    serialize(): string {
      return ''
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

import { TerminalSessionRegistry } from '#/web/components/terminal/TerminalSessionRegistry.ts'

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

function makeCreateResult() {
  return {
    ok: true as const,
    key: `${REPO_ROOT}\0${WORKTREE_PATH}\0terminal-1`,
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
  }
}

describe('TerminalSessionRegistry create flow', () => {
  let registry: TerminalSessionRegistry

  beforeEach(() => {
    mocks.createMock.mockReset()
    mocks.createMock.mockResolvedValue(makeCreateResult())
    mocks.proposeTerminalGeometryMock.mockClear()
    mocks.preloadTerminalFontMock.mockClear()
    mocks.attachmentIdMock.mockClear()
    registry = new TerminalSessionRegistry(() => REPO_ROOT)
    registry.setRepoIndex(makeRepoIndex())
  })

  afterEach(() => {
    registry.destroy()
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
})
