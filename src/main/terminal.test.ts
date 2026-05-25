import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { ipcMain } from 'electron'
import { closeWorktreeSession, pruneRepoSessions, wireTerminalIpc } from '#/main/terminal.ts'
import { openTerminalSession } from '#/main/terminal-core.ts'
import { getWorktrees } from '#/main/git/worktrees.ts'
import { registerTrustedAppPath, registerTrustedWebContents } from '#/main/ipc/trusted-webcontents.ts'
import type { TerminalOpenInput, TerminalRestartInput } from '#/shared/terminal.ts'

const ipcHandlers = new Map<string, (_event: unknown, input: any) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, input: any) => unknown) => {
      ipcHandlers.set(channel, handler)
    }),
  },
  BrowserWindow: { getAllWindows: () => [] },
  app: { on: vi.fn() },
}))

vi.mock('#/main/git/worktrees.ts', () => ({
  getWorktrees: vi.fn(),
}))

vi.mock('#/main/terminal-core.ts', () => ({
  closeAllTerminalSessions: vi.fn(),
  closeOwnedTerminalSession: vi.fn(),
  closeTerminalKey: vi.fn(),
  closeTerminalOwner: vi.fn(),
  closeTerminalSession: vi.fn(),
  isValidTerminalSessionId: (value: unknown) => typeof value === 'string' && value.startsWith('term_'),
  isValidTerminalWriteData: (value: unknown) => typeof value === 'string',
  openTerminalSession: vi.fn(() => ({
    ok: true,
    sessionId: 'term_123456789012',
    replay: '',
    replaySeq: 0,
    replayTruncated: false,
    processName: 'zsh',
  })),
  pruneTerminalScope: vi.fn(),
  resizeTerminalSession: vi.fn(() => true),
  wireTerminalSessionCleanup: vi.fn(),
  writeTerminalSession: vi.fn(() => true),
}))

describe('terminal IPC', () => {
  beforeAll(() => {
    registerTrustedAppPath('/app/dist/renderer/index.html')
    registerTrustedWebContents({ id: 1, once: vi.fn() } as any)
    registerTrustedWebContents({ id: 7, once: vi.fn() } as any)
    registerTrustedWebContents({ id: 9, once: vi.fn() } as any)
    wireTerminalIpc()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getWorktrees).mockResolvedValue([
      { path: '/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/repo-linked', branch: 'feature', isBare: false, isPrimary: false },
    ])
  })

  test('wires terminal handlers', () => {
    expect(ipcHandlers.has('goblin:terminal-open')).toBe(true)
    expect(ipcHandlers.has('goblin:terminal-restart')).toBe(true)
    expect(ipcHandlers.has('goblin:terminal-close')).toBe(true)
    expect(ipcHandlers.has('goblin:terminal-prune-repo')).toBe(true)
    expect(ipcHandlers.has('goblin:terminal-close-repo')).toBe(false)
    expect(ipcHandlers.has('goblin:terminal-close-worktree')).toBe(false)
  })

  test('opens a validated worktree terminal without replacement', async () => {
    const result = await invoke<TerminalOpenInput>('goblin:terminal-open', {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      terminalId: 'terminal-1',
      cols: 80,
      rows: 24,
    })

    expect(result).toEqual({
      ok: true,
      sessionId: 'term_123456789012',
      replay: '',
      replaySeq: 0,
      replayTruncated: false,
      processName: 'zsh',
    })
    expect(openTerminalSession).toHaveBeenCalledWith({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/repo-linked\0terminal-1',
      cwd: '/repo-linked',
      cols: 80,
      rows: 24,
      forceNew: false,
    })
  })

  test('restarts a validated worktree terminal with replacement', async () => {
    await invoke<TerminalRestartInput>('goblin:terminal-restart', {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      terminalId: 'terminal-1',
      cols: 100,
      rows: 30,
    })

    expect(openTerminalSession).toHaveBeenCalledWith({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/repo-linked\0terminal-1',
      cwd: '/repo-linked',
      cols: 100,
      rows: 30,
      forceNew: true,
    })
  })

  test('rejects invalid open inputs before reading worktrees', async () => {
    const result = await invoke('goblin:terminal-open', {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      terminalId: 'terminal-1',
      cols: 0,
      rows: 24,
    })

    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(getWorktrees).not.toHaveBeenCalled()
    expect(openTerminalSession).not.toHaveBeenCalled()
  })

  test('rejects terminal IPC calls from untrusted senders', async () => {
    const result = await invokeWithEvent(
      'goblin:terminal-open',
      {
        repoRoot: '/repo',
        branch: 'feature',
        worktreePath: '/repo-linked',
        terminalId: 'terminal-1',
        cols: 80,
        rows: 24,
      },
      {
        sender: { id: 99, once: vi.fn() },
        senderFrame: { url: 'https://example.com/' },
      },
    )

    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(getWorktrees).not.toHaveBeenCalled()
    expect(openTerminalSession).not.toHaveBeenCalled()
  })

  test('rejects stale worktree paths and branch mismatches', async () => {
    await expect(
      invoke('goblin:terminal-open', {
        repoRoot: '/repo',
        branch: 'main',
        worktreePath: '/repo-linked',
        terminalId: 'terminal-1',
        cols: 80,
        rows: 24,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.worktree-not-found-for-branch' })
    expect(openTerminalSession).not.toHaveBeenCalled()
  })

  test('closes owner sessions when the renderer webContents is destroyed', async () => {
    const core = await import('#/main/terminal-core.ts')
    const sender = { id: 7, once: vi.fn() }

    await invokeWithSender(
      'goblin:terminal-open',
      {
        repoRoot: '/repo',
        branch: 'feature',
        worktreePath: '/repo-linked',
        terminalId: 'terminal-1',
        cols: 80,
        rows: 24,
      },
      sender,
    )
    const onDestroyed = sender.once.mock.calls.find(([eventName]) => eventName === 'destroyed')?.[1]
    expect(onDestroyed).toBeTypeOf('function')

    onDestroyed?.()
    expect(core.closeTerminalOwner).toHaveBeenCalledWith(7)
  })

  test('scopes write, resize, and close IPC calls to the sender owner', async () => {
    const core = await import('#/main/terminal-core.ts')
    const sender = { id: 9, once: vi.fn() }

    vi.mocked(core.closeOwnedTerminalSession).mockReturnValueOnce(true)

    expect(invokeWithSender('goblin:terminal-write', { sessionId: 'term_123456789012', data: 'input' }, sender)).toBe(
      true,
    )
    expect(
      invokeWithSender('goblin:terminal-resize', { sessionId: 'term_123456789012', cols: 100, rows: 30 }, sender),
    ).toBe(true)
    expect(invokeWithSender('goblin:terminal-close', { sessionId: 'term_123456789012' }, sender)).toBe(true)

    expect(core.writeTerminalSession).toHaveBeenCalledWith(9, 'term_123456789012', 'input')
    expect(core.resizeTerminalSession).toHaveBeenCalledWith(9, 'term_123456789012', 100, 30)
    expect(core.closeOwnedTerminalSession).toHaveBeenCalledWith(9, 'term_123456789012')
  })

  test('returns false for rejected terminal mutation inputs', () => {
    expect(invoke('goblin:terminal-write', { sessionId: 'invalid', data: 'input' })).toBe(false)
    expect(invoke('goblin:terminal-resize', { sessionId: 'term_123456789012', cols: 0, rows: 30 })).toBe(false)
    expect(invoke('goblin:terminal-close', { sessionId: 'invalid' })).toBe(false)
    expect(invoke('goblin:terminal-prune-repo', { repoRoot: '/repo', worktreePaths: ['relative'] })).toBe(false)
  })

  test('returns true after pruning a valid repo terminal scope', () => {
    expect(invoke('goblin:terminal-prune-repo', { repoRoot: '/repo', worktreePaths: ['/repo-linked'] })).toBe(true)
  })
})

describe('terminal session cleanup helpers', () => {
  test('normalizes repo and worktree keys before closing or pruning', async () => {
    const core = await import('#/main/terminal-core.ts')

    closeWorktreeSession('/repo/../repo', '/repo-linked/../repo-linked')
    pruneRepoSessions(7, '/repo/../repo', ['/repo-linked/../repo-linked'])

    expect(core.closeTerminalKey).toHaveBeenCalledWith('/repo\0/repo-linked')
    expect(core.pruneTerminalScope).toHaveBeenCalledWith(7, '/repo', new Set(['/repo\0/repo-linked']))
  })
})

function invoke<TInput>(channel: string, input: TInput): unknown {
  return invokeWithSender(channel, input, { id: 1, once: vi.fn() })
}

function invokeWithSender<TInput>(
  channel: string,
  input: TInput,
  sender: { id: number; once: ReturnType<typeof vi.fn> },
): unknown {
  return invokeWithEvent(channel, input, {
    sender,
    senderFrame: { url: 'file:///app/dist/renderer/index.html?theme=light' },
  })
}

function invokeWithEvent<TInput>(channel: string, input: TInput, event: unknown): unknown {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`missing handler: ${channel}`)
  return handler(event, input)
}
