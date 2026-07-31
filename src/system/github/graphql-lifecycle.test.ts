import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
import type * as ExecaModule from 'execa'

const execaMock = vi.hoisted(() => vi.fn())

vi.mock('execa', async () => {
  const actual = await vi.importActual<typeof ExecaModule>('execa')
  return { ...actual, execa: execaMock }
})

vi.mock('#/system/github-cli.ts', () => ({
  buildGitHubCliPath: vi.fn(() => process.env.PATH ?? ''),
}))

const repo = { host: 'github.com', owner: 'acme', name: 'repo' }

describe('graphqlRequestResult lifecycle', () => {
  afterEach(() => {
    execaMock.mockReset()
    vi.resetModules()
  })

  test('classifies missing gh login as NO_AUTH_TOKEN', async () => {
    execaMock.mockRejectedValueOnce(
      Object.assign(new Error('not logged in'), {
        stderr: 'gh: To get started with GitHub CLI, please run: gh auth login',
      }),
    )
    const { graphqlRequestResult } = await import('#/system/github/graphql.ts')

    const result = await graphqlRequestResult('/tmp/repo', repo, 'query Test { viewer { login } }', {}, 'Test')

    expect(result.ok).toBe(false)
    expect(execaMock).toHaveBeenCalledTimes(1)
    if (!result.ok) {
      expect(result.error.code).toBe('NO_AUTH_TOKEN')
    }
  })

  test('does not invoke gh when aborted before queue execution starts', async () => {
    const { graphqlRequestResult } = await import('#/system/github/graphql.ts')
    const ctrl = new AbortController()
    ctrl.abort()

    const result = await graphqlRequestResult(
      '/tmp/repo',
      repo,
      'query Test { viewer { login } }',
      {},
      'Test',
      ctrl.signal,
    )

    expect(execaMock).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TIMEOUT')
  })

  test('settles queued requests promptly when aborted before execution starts', async () => {
    const releases: Array<() => void> = []
    execaMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(() => resolve({ stdout: JSON.stringify({ data: { ok: true } }) }))
        }),
    )
    const { graphqlRequestResult } = await import('#/system/github/graphql.ts')
    const running = Array.from({ length: 3 }, (_, index) =>
      graphqlRequestResult<{ ok: boolean }>(
        '/tmp/repo',
        repo,
        `query Test${index} { viewer { login } }`,
        {},
        `Test${index}`,
      ),
    )
    await vi.waitFor(() => expect(execaMock).toHaveBeenCalledTimes(3))
    const ctrl = new AbortController()
    const queued = graphqlRequestResult<{ ok: boolean }>(
      '/tmp/repo',
      repo,
      'query Test { viewer { login } }',
      {},
      'Test',
      ctrl.signal,
    )

    let settled = false
    void queued.then(() => {
      settled = true
    })
    ctrl.abort()
    await flushMicrotasks()
    releases.forEach((release) => release())
    await Promise.all(running)

    expect(settled).toBe(true)
    expect(execaMock).toHaveBeenCalledTimes(3)
    await expect(queued).resolves.toMatchObject({ ok: false })
  })
})
