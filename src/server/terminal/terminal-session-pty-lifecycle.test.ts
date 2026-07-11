import { describe, expect, test, vi } from 'vitest'
import { createEmptyTerminalRenderState } from '#/server/terminal/terminal-render-state.ts'
import {
  TerminalPtyBinding,
  type TerminalPtyBindingEvents,
  type TerminalPtySessionState,
} from '#/server/terminal/terminal-session-pty-lifecycle.ts'
import { createPtyHandle, type PtySpawnResult, type PtySupervisor } from '#/server/terminal/pty-supervisor.ts'

describe('TerminalPtyBinding aborted spawn retirement', () => {
  test('retains a late handle after the first kill fails so later retirement can retry', async () => {
    const deferredSpawn = Promise.withResolvers<PtySpawnResult>()
    const killAndWait = vi
      .fn<(handle: ReturnType<typeof createPtyHandle>) => Promise<void>>()
      .mockRejectedValueOnce(new Error('PTY close timed out'))
      .mockResolvedValue(undefined)
    const supervisor = {
      mode: 'in-process',
      spawn: vi.fn(async () => await deferredSpawn.promise),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      killAndWait,
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
      processName: vi.fn(() => 'zsh'),
      getDiagnostics: vi.fn(),
      shutdown: vi.fn(),
    } as unknown as PtySupervisor
    const events = {
      isSessionLive: vi.fn(() => true),
      emitLifecycle: vi.fn(),
      emitOutput: vi.fn(),
      emitBell: vi.fn(),
      emitTitle: vi.fn(),
      emitExit: vi.fn(),
      closeSession: vi.fn(),
    } satisfies TerminalPtyBindingEvents<TerminalPtySessionState<string>>
    const binding = new TerminalPtyBinding(supervisor, events)
    const session: TerminalPtySessionState<string> = {
      id: 'pty_runtime_late_123456',
      userId: 'user-test',
      cwd: '/repo/worktree',
      cols: 80,
      rows: 24,
      render: createEmptyTerminalRenderState(80, 24),
      phase: 'opening',
      message: null,
      terminalRuntimeGeneration: 0,
    }
    const runtime = new AbortController()

    const spawn = binding.spawn(session, runtime.signal)
    runtime.abort(new Error('error.repo-runtime-stale'))
    await expect(spawn).resolves.toEqual({
      generation: 1,
      result: { ok: false, message: 'error.repo-runtime-stale' },
    })

    const lateHandle = createPtyHandle('pty_late_handle_123456')
    deferredSpawn.resolve({ ok: true, handle: lateHandle, processName: 'zsh' })
    await vi.waitFor(() => expect(killAndWait).toHaveBeenCalledTimes(1))
    expect((binding as any).retiringHandles.get(lateHandle.ptySessionId)?.handle).toBe(lateHandle)

    await expect(binding.disposeAndWait(session)).rejects.toThrow('PTY close timed out')
    expect((binding as any).retiringHandles.get(lateHandle.ptySessionId)?.handle).toBe(lateHandle)

    await binding.disposeAndWait(session)
    expect(killAndWait).toHaveBeenCalledTimes(2)
    expect((binding as any).retiringHandles.size).toBe(0)
  })
})
