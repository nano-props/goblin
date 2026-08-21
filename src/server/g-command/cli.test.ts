import os from 'node:os'
import path from 'node:path'
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises'
import { describe, expect, test, vi } from 'vitest'
import { runGoblinCommand } from '#/server/g-command/cli.ts'
import type { GoblinCommandIo, GoblinCommandTransport } from '#/server/g-command/context.ts'

type PostJsonFn = (pathname: string, body: unknown, decode: (value: unknown) => unknown) => Promise<unknown>
type StdoutFn = (message: string) => void
type StderrFn = (message: string) => void

function makeIo(): {
  io: GoblinCommandIo
  stdout: ReturnType<typeof vi.fn<StdoutFn>>
  stderr: ReturnType<typeof vi.fn<StderrFn>>
} {
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
} {
  const postJson = vi.fn<PostJsonFn>()
  const transport: GoblinCommandTransport = {
    postJson: postJson as GoblinCommandTransport['postJson'],
  }
  return { transport, postJson }
}

describe('g command cli', () => {
  test('prints help for the help command', async () => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()

    const code = await runGoblinCommand(['help'], {}, io, transport)

    expect(code).toBe(0)
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('g help'))
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('g init'))
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('Open the changes tab'))
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('g info'))
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('g log'))
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('g term [list|prune]'))
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

  test.each(['delta', 'info', 'log'] as const)('g %s posts through the consolidated endpoint', async (command) => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()
    postJson.mockResolvedValue({ output: '' })

    const code = await runGoblinCommand([command], {}, io, transport)

    expect(code).toBe(0)
    expect(postJson).toHaveBeenCalledWith(
      '/api/terminal-command',
      { command, payload: { args: [] } },
      expect.any(Function),
    )
  })

  test('g init creates an empty commented goblin.toml in the current directory', async () => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()
    await using temporaryDirectory = await mkdtempDisposable(path.join(os.tmpdir(), 'g-command-init-test-'))
    const tmp = temporaryDirectory.path
    const previousCwd = process.cwd()
    try {
      process.chdir(tmp)

      const code = await runGoblinCommand(['init'], {}, io, transport)

      expect(code).toBe(0)
      expect(io.stdout).toHaveBeenCalledWith('Created goblin.toml')
      expect(postJson).not.toHaveBeenCalled()
      const config = await readFile(path.join(tmp, 'goblin.toml'), 'utf8')
      expect(config.startsWith('# Configure worktree bootstrap')).toBe(true)
      expect(config).toContain('Add [worktree]')
      expect(config).toContain('Paths are repo-relative.')
      expect(config).toContain('# Example:')
      expect(config).toContain('#   setup = "bun install"')
      expect(config).not.toContain('\n[worktree]')
    } finally {
      process.chdir(previousCwd)
    }
  })

  test('g init refuses to overwrite an existing goblin.toml', async () => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()
    await using temporaryDirectory = await mkdtempDisposable(path.join(os.tmpdir(), 'g-command-init-test-'))
    const tmp = temporaryDirectory.path
    const previousCwd = process.cwd()
    try {
      process.chdir(tmp)
      await writeFile(path.join(tmp, 'goblin.toml'), 'existing\n')

      const code = await runGoblinCommand(['init'], {}, io, transport)

      expect(code).toBe(1)
      expect(io.stderr).toHaveBeenCalledWith('g: goblin.toml exists')
      expect(postJson).not.toHaveBeenCalled()
      await expect(readFile(path.join(tmp, 'goblin.toml'), 'utf8')).resolves.toBe('existing\n')
    } finally {
      process.chdir(previousCwd)
    }
  })

  test('forwards extra view arguments for server-side validation', async () => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()

    postJson.mockRejectedValue(new Error("'delta' does not take arguments"))
    const code = await runGoblinCommand(['delta', 'extra'], {}, io, transport)

    expect(code).toBe(1)
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('does not take arguments'))
    expect(postJson).toHaveBeenCalledWith(
      '/api/terminal-command',
      { command: 'delta', payload: { args: ['extra'] } },
      expect.any(Function),
    )
  })

  test('surfaces command errors with a non-zero exit code', async () => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()
    postJson.mockRejectedValue(new Error('no Goblin window is currently listening'))

    const code = await runGoblinCommand(['delta'], {}, io, transport)

    expect(code).toBe(1)
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('no Goblin window'))
  })

  test('g term shows the current built-in terminal', async () => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()
    postJson.mockResolvedValue({ output: 'Terminal: current' })

    const code = await runGoblinCommand(
      ['term'],
      { GOBLIN_TERMINAL_SESSION_ID: 'term-111111111111111111111' },
      io,
      transport,
    )

    expect(code).toBe(0)
    expect(postJson).toHaveBeenCalledWith(
      '/api/terminal-command',
      {
        command: 'term',
        payload: { terminalSessionId: 'term-111111111111111111111', args: [] },
      },
      expect.any(Function),
    )
    expect(io.stdout).toHaveBeenCalledWith('Terminal: current')
  })

  test('g term list prints the current workspace terminal list', async () => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()
    postJson.mockResolvedValue({ output: 'AVAILABILITY\navailable\norphaned' })

    const code = await runGoblinCommand(
      ['term', 'list'],
      { GOBLIN_TERMINAL_SESSION_ID: 'term-111111111111111111111' },
      io,
      transport,
    )

    expect(code).toBe(0)
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('AVAILABILITY'))
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('orphaned'))
  })

  test('g term prune reports closed orphan terminals', async () => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()
    postJson.mockResolvedValue({ output: 'Pruned 1 orphan terminal.' })

    const code = await runGoblinCommand(
      ['term', 'prune'],
      { GOBLIN_TERMINAL_SESSION_ID: 'term-111111111111111111111' },
      io,
      transport,
    )

    expect(code).toBe(0)
    expect(io.stdout).toHaveBeenCalledWith('Pruned 1 orphan terminal.')
  })

  test('g term requires a terminal identity from a newly opened Goblin terminal', async () => {
    const { io } = makeIo()
    const { transport, postJson } = makeTransport()
    postJson.mockRejectedValue(new Error('g term must run inside a current Goblin terminal'))

    const code = await runGoblinCommand(['term', 'list'], {}, io, transport)

    expect(code).toBe(1)
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('must run inside a current Goblin terminal'))
    expect(postJson).toHaveBeenCalledWith(
      '/api/terminal-command',
      { command: 'term', payload: { args: ['list'] } },
      expect.any(Function),
    )
  })
})
