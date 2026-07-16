import { describe, expect, test, vi } from 'vitest'
import { createEmptyTerminalRenderState } from '#/server/terminal/terminal-render-state.ts'
import {
  TerminalPtyBinding,
  type TerminalPtyBindingEvents,
  type TerminalPtySessionState,
} from '#/server/terminal/terminal-session-pty-lifecycle.ts'
import { createPtyHandle, type PtySpawnResult, type PtySupervisor } from '#/server/terminal/pty-supervisor.ts'
import type { TerminalWriteResult } from '#/shared/terminal-types.ts'

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
      write: vi.fn(async () => ({ status: 'accepted' as const })),
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
      confirmedExit: vi.fn(),
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

    const spawn = binding.spawn(session, session.cols, session.rows, runtime.signal)
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

describe('TerminalPtyBinding input acknowledgement', () => {
  test('settles every microtask-batched caller from the supervisor result', async () => {
    const deferredWrite = Promise.withResolvers<TerminalWriteResult>()
    const { binding, session, supervisor } = await createBoundBinding(() => deferredWrite.promise)

    const first = binding.write(session, 'a')
    const second = binding.write(session, 'b')
    await Promise.resolve()

    expect(supervisor.write).toHaveBeenCalledWith({ ptySessionId: 'pty_bound_123456' }, 'ab')
    deferredWrite.resolve({ status: 'accepted' })
    await expect(Promise.all([first, second])).resolves.toEqual([{ status: 'accepted' }, { status: 'accepted' }])
  })

  test('settles an in-flight old-handle batch as indeterminate on disposal', async () => {
    const deferredWrite = Promise.withResolvers<TerminalWriteResult>()
    const { binding, session } = await createBoundBinding(() => deferredWrite.promise)
    const write = binding.write(session, 'input')
    await Promise.resolve()

    binding.dispose(session)

    await expect(write).resolves.toEqual({ status: 'indeterminate' })
    deferredWrite.resolve({ status: 'accepted' })
    await Promise.resolve()
  })
})

async function createBoundBinding(write: () => Promise<TerminalWriteResult>) {
  const handle = createPtyHandle('pty_bound_123456')
  const supervisor = {
    mode: 'in-process',
    spawn: vi.fn(async () => ({ ok: true as const, handle, processName: 'zsh' })),
    write: vi.fn(write),
    resize: vi.fn(),
    kill: vi.fn(),
    killAndWait: vi.fn(async () => {}),
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
    confirmedExit: vi.fn(),
  } satisfies TerminalPtyBindingEvents<TerminalPtySessionState<string>>
  const binding = new TerminalPtyBinding(supervisor, events)
  const session: TerminalPtySessionState<string> = {
    id: 'pty_runtime_bound_123456',
    userId: 'user-test',
    cwd: '/repo/worktree',
    cols: 80,
    rows: 24,
    render: createEmptyTerminalRenderState(80, 24),
    phase: 'opening',
    message: null,
    terminalRuntimeGeneration: 0,
  }
  const spawned = await binding.spawn(session, session.cols, session.rows)
  expect(spawned.result).toEqual({ ok: true })
  return { binding, session, supervisor }
}
