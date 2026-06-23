import { describe, expect, test, vi } from 'vitest'
import { runGoblinCommand } from '#/server/g-command/cli.ts'
import type { GoblinCommandIo, GoblinCommandTransport } from '#/server/g-command/context.ts'

type PostJsonFn = (pathname: string, body: unknown) => Promise<unknown>
type GetJsonFn = (pathname: string, query?: Record<string, string>) => Promise<unknown>
type StdoutFn = (message: string) => void
type StderrFn = (message: string) => void

function makeIo(): { io: GoblinCommandIo; stdout: ReturnType<typeof vi.fn<StdoutFn>>; stderr: ReturnType<typeof vi.fn<StderrFn>> } {
  const stdout = vi.fn<StdoutFn>()
  const stderr = vi.fn<StderrFn>()
  return {
    io: { stdout, stderr },
    stdout,
    stderr,
  }
}

function makeTransport(): {
  transport: GoblinCommandTransport
  postJson: ReturnType<typeof vi.fn<PostJsonFn>>
  get: ReturnType<typeof vi.fn<GetJsonFn>>
} {
  const postJson = vi.fn<PostJsonFn>()
  const get = vi.fn<GetJsonFn>()
  const transport: GoblinCommandTransport = {
    postJson: postJson as GoblinCommandTransport['postJson'],
    get: get as GoblinCommandTransport['get'],
  }
  return { transport, postJson, get }
}

describe('g command cli', () => {
  test('prints help for the help command', async () => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()

    const code = await runGoblinCommand(['help'], {}, io, transport)

    expect(code).toBe(0)
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('g help'))
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('Open the changes tab'))
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('g i'))
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('g log'))
    expect(postJson).not.toHaveBeenCalled()
  })

  test('prints help and falls back to it when no command is given', async () => {
    const { io } = makeIo()
    const { transport } = makeTransport()

    const code = await runGoblinCommand([], {}, io, transport)

    expect(code).toBe(0)
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('g help'))
  })

  test('rejects unknown commands and prints usage', async () => {
    const { io } = makeIo()
    const { transport } = makeTransport()

    const code = await runGoblinCommand(['frobnicate'], {}, io, transport)

    expect(code).toBe(2)
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('g: unknown command: frobnicate'))
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('g help'))
  })

  test('g ss posts a view intent for the changes tab', async () => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()
    postJson.mockResolvedValue({ ok: true })

    const code = await runGoblinCommand(['ss'], {}, io, transport)

    expect(code).toBe(0)
    expect(postJson).toHaveBeenCalledWith('/api/repo/view', { tab: 'changes' })
  })

  test('g i posts a view intent for the status tab', async () => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()
    postJson.mockResolvedValue({ ok: true })

    const code = await runGoblinCommand(['i'], {}, io, transport)

    expect(code).toBe(0)
    expect(postJson).toHaveBeenCalledWith('/api/repo/view', { tab: 'status' })
  })

  test('g log posts a view intent for the history tab', async () => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()
    postJson.mockResolvedValue({ ok: true })

    const code = await runGoblinCommand(['log'], {}, io, transport)

    expect(code).toBe(0)
    expect(postJson).toHaveBeenCalledWith('/api/repo/view', { tab: 'history' })
  })

  test('rejects extra positional arguments for view commands', async () => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()

    const code = await runGoblinCommand(['ss', 'extra'], {}, io, transport)

    expect(code).toBe(2)
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('does not take arguments'))
    expect(postJson).not.toHaveBeenCalled()
  })

  test('surfaces server-side errors with non-zero exit code', async () => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()
    postJson.mockResolvedValue({ ok: false, message: 'no Goblin window is currently listening' })

    const code = await runGoblinCommand(['ss'], {}, io, transport)

    expect(code).toBe(1)
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('no Goblin window'))
  })

  test('surfaces transport-level errors with non-zero exit code', async () => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()
    postJson.mockRejectedValue(new Error('connection refused'))

    const code = await runGoblinCommand(['ss'], {}, io, transport)

    expect(code).toBe(1)
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('connection refused'))
  })
})
