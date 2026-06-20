import { describe, expect, test, vi } from 'vitest'
import { runGoblinCommand, summarizeStatus } from '#/server/g-command/cli.ts'

function makeIo() {
  const fetchMock = vi.fn()
  return {
    io: {
      stdout: vi.fn(),
      stderr: vi.fn(),
      fetch: fetchMock as unknown as typeof fetch,
    },
    fetchMock,
  }
}

describe('g command cli', () => {
  test('prints help', async () => {
    const { io, fetchMock } = makeIo()

    const code = await runGoblinCommand(['help'], {}, io)

    expect(code).toBe(0)
    expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('g status [cwd]'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('prints current worktree status through the Goblin API', async () => {
    const { io, fetchMock } = makeIo()
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn(async () => [
        {
          path: '/repo/worktree',
          branch: 'feature',
          entries: [{ x: 'M', y: ' ', path: 'src/app.ts' }],
        },
      ]),
    })

    const code = await runGoblinCommand(
      ['status'],
      {
        GOBLIN_SERVER_URL: 'http://127.0.0.1:32100',
        GOBLIN_SERVER_ACCESS_TOKEN: 'secret',
        GOBLIN_WORKTREE_PATH: '/repo/worktree',
      },
      io,
    )

    expect(code).toBe(0)
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:32100/api/repo/status?cwd=%2Frepo%2Fworktree'),
      {
        headers: {
          'x-goblin-access-token': 'secret',
        },
      },
    )
    expect(io.stdout).toHaveBeenCalledWith('1 change\nfeature:\n  M  src/app.ts')
  })

  test('requires the inherited Goblin access token for API commands', async () => {
    const { io, fetchMock } = makeIo()

    const code = await runGoblinCommand(['status'], { GOBLIN_WORKTREE_PATH: '/repo' }, io)

    expect(code).toBe(1)
    expect(io.stderr).toHaveBeenCalledWith('g: GOBLIN_SERVER_ACCESS_TOKEN is not set')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('summarizes clean status', () => {
    expect(summarizeStatus([{ path: '/repo', entries: [] }])).toBe('clean')
  })
})
