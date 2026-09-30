import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import type { ClientBootstrapSnapshot } from '#/shared/bootstrap.ts'
import type { ClientBridge } from '#/web/bridge/types.ts'
import { setClientBridgeForTests } from '#/web/bridge/client.ts'
import { mockFetch } from '#/test-utils/fetch-mock.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const workspaceId = workspaceIdForTest('goblin+file:///workspace')
const executionTarget = {
  kind: 'workspace-root' as const,
  workspaceId,
  workspaceRuntimeId: 'workspace-runtime-test',
}

function webBootstrap(overrides: Partial<ClientBootstrapSnapshot> = {}): ClientBootstrapSnapshot {
  return {
    initialServer: null,
    ...overrides,
  }
}

function installWebBootstrap(bootstrap: ClientBootstrapSnapshot): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __GOBLIN_BOOTSTRAP__: bootstrap,
      location: {
        href: bootstrap.initialServer?.url ?? 'http://127.0.0.1:32100/',
        origin: bootstrap.initialServer?.url?.replace(/\/$/, '') ?? 'http://127.0.0.1:32100',
        protocol: 'http:',
        search: '',
      },
      matchMedia: vi.fn(() => ({ matches: true })),
    },
  })
}

function testBridge(overrides: Partial<ClientBridge> = {}): ClientBridge {
  return {
    getBootstrap: () => webBootstrap(),

    saveClipboardFiles: () => Promise.resolve([]),

    appRealtime: () => ({
      kickReconnect: () => {},
      onRecovered: () => () => {},
    }),
    terminal: (() => {
      throw new Error('unused terminal client')
    }) as never,
    workspacePaneTabs: (() => {
      throw new Error('unused workspace pane tabs client')
    }) as never,
    workspacePaneRuntime: (() => {
      throw new Error('unused workspace pane runtime client')
    }) as never,
    ...overrides,
  }
}

describe('repo-client', () => {
  const workspaceRuntimeId = 'repo-runtime-test'

  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    setClientBridgeForTests(null)
  })

  test('opens repository branch URLs in the browser', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const bridgeModule = await import('#/web/bridge/client.ts')
    window.open = vi.fn(() => null)
    bridgeModule.setClientBridgeForTests(
      testBridge({
        getBootstrap: () => ({
          ...webBootstrap(),
          initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
        }),
      }),
    )
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'https://github.com/acme/repo/tree/feature/test' }),
    }))
    const { openRepoUrl } = await import('#/web/repos/client.ts')
    await expect(
      openRepoUrl(workspaceId, workspaceRuntimeId, { type: 'branch', branch: 'feature/test' }),
    ).resolves.toEqual({
      ok: true,
      message: '',
    })
    expect(window.open).toHaveBeenCalledWith(
      'https://github.com/acme/repo/tree/feature/test',
      '_blank',
      'noopener,noreferrer',
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/open-url',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({
          cwd: workspaceId,
          workspaceRuntimeId,
          target: { type: 'branch', branch: 'feature/test' },
        }),
      }),
    )
  })

  test('opens repository commit URLs in the browser', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const bridgeModule = await import('#/web/bridge/client.ts')
    window.open = vi.fn(() => null)
    bridgeModule.setClientBridgeForTests(
      testBridge({
        getBootstrap: () => ({
          ...webBootstrap(),
          initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
        }),
      }),
    )
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'https://github.com/acme/repo/commit/abcdef1' }),
    }))
    const { openRepoUrl } = await import('#/web/repos/client.ts')

    await expect(openRepoUrl(workspaceId, workspaceRuntimeId, { type: 'commit', hash: 'abcdef1' })).resolves.toEqual({
      ok: true,
      message: '',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/open-url',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({ cwd: workspaceId, workspaceRuntimeId, target: { type: 'commit', hash: 'abcdef1' } }),
      }),
    )
    expect(window.open).toHaveBeenCalledWith(
      'https://github.com/acme/repo/commit/abcdef1',
      '_blank',
      'noopener,noreferrer',
    )
  })

  test('clones repositories through the server over HTTP', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'ok', path: '/tmp/repo' }),
    }))
    const { cloneRepository } = await import('#/web/repos/client.ts')
    await expect(
      cloneRepository({
        url: 'https://example.com/repo.git',
        parentPath: '/tmp',
        directoryName: 'repo',
      }),
    ).resolves.toEqual({ ok: true, message: 'ok', path: '/tmp/repo' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/clone',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({
          url: 'https://example.com/repo.git',
          parentPath: '/tmp',
          directoryName: 'repo',
        }),
      }),
    )
  })

  test('reads worktree status through the runtime-scoped POST endpoint', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const response = { workspaceRuntimeId, status: [], loadedAt: 1_000 }
    const fetchMock = mockFetch(async () => ({ ok: true, json: async () => response }))
    const { getRepoWorktreeStatus } = await import('#/web/repos/client.ts')

    await expect(getRepoWorktreeStatus(workspaceId, workspaceRuntimeId)).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/worktree-status',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({ cwd: workspaceId, workspaceRuntimeId }),
      }),
    )
  })

  test('maps worktree status transport failures to a stable display key while preserving the cause', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    mockFetch(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, code: 'BAD_REQUEST', message: 'error.failed-read-repo' }),
    }))
    const { getRepoWorktreeStatus } = await import('#/web/repos/client.ts')

    await expect(getRepoWorktreeStatus(workspaceId, workspaceRuntimeId)).rejects.toMatchObject({
      message: 'error.failed-read-repo',
      cause: expect.objectContaining({ message: 'error.failed-read-repo', code: 'BAD_REQUEST', status: 400 }),
    })
  })

  test('preserves a membership read conflict without collapsing it into a repository failure', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    mockFetch(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, code: 'BAD_REQUEST', message: 'error.repo-membership-changing' }),
    }))
    const { getRepoWorktreeStatus } = await import('#/web/repos/client.ts')

    await expect(getRepoWorktreeStatus(workspaceId, workspaceRuntimeId)).rejects.toThrow(
      'error.repo-membership-changing',
    )
  })

  test('preserves a stale runtime read so the caller can offer runtime recovery', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    mockFetch(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, code: 'BAD_REQUEST', message: 'error.workspace-runtime-stale' }),
    }))
    const { getRepoWorktreeStatus } = await import('#/web/repos/client.ts')

    await expect(getRepoWorktreeStatus(workspaceId, workspaceRuntimeId)).rejects.toThrow(
      'error.workspace-runtime-stale',
    )
  })

  test('leaves Git network deadlines to the server and preserves post-delivery cancellation as uncertain', async () => {
    useFakeTimers()
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const requestSignals: AbortSignal[] = []
    mockFetch((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal
      if (signal) requestSignals.push(signal)
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    const { fetchRepo, pullRepoBranch, pushRepoBranch } = await import('#/web/repos/client.ts')
    const controllers = [new AbortController(), new AbortController(), new AbortController()]
    const requests = [
      fetchRepo(workspaceId, workspaceRuntimeId, controllers[0]!.signal),
      pullRepoBranch(workspaceId, workspaceRuntimeId, 'main', undefined, controllers[1]!.signal),
      pushRepoBranch(workspaceId, workspaceRuntimeId, 'main', controllers[2]!.signal),
    ]
    const assertions = requests.map(
      async (request) => await expect(request).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' }),
    )

    await vi.advanceTimersByTimeAsync(240_000)
    expect(requestSignals).toHaveLength(3)
    expect(requestSignals.every((signal) => !signal.aborted)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)

    for (const controller of controllers) controller.abort(new Error('caller cancelled'))
    await Promise.all(assertions)
  })

  test('rejects malformed repository responses at the client boundary', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    mockFetch(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'ok', unexpected: true }),
    }))

    const { fetchRepo } = await import('#/web/repos/client.ts')
    await expect(fetchRepo(workspaceId, workspaceRuntimeId)).rejects.toThrow()
  })

  test('decodes the server-confirmed target from a successful worktree creation', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    mockFetch(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'created', worktreePath: '/private/tmp/repo-feature' }),
    }))

    const { createRepoWorktree } = await import('#/web/repos/client.ts')
    await expect(
      createRepoWorktree(
        workspaceId,
        workspaceRuntimeId,
        {
          worktreePath: '/tmp/nested/../repo-feature',
          mode: { kind: 'newBranch', newBranch: 'feature/work', baseRef: 'main' },
        },
        { kind: 'skip' },
      ),
    ).resolves.toEqual({ ok: true, message: 'created', worktreePath: '/private/tmp/repo-feature' })
  })

  test('preserves an uncertain clone outcome after the clone request watchdog fires', async () => {
    useFakeTimers()
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    let requestSignal: AbortSignal | undefined
    const fetchMock = mockFetch((_url, init) => {
      requestSignal = (init as RequestInit | undefined)?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true })
      })
    })

    const { cloneRepository } = await import('#/web/repos/client.ts')
    const request = cloneRepository({
      url: 'https://example.com/repo.git',
      parentPath: '/tmp',
      directoryName: 'repo',
    })
    const assertion = expect(request).rejects.toMatchObject({
      code: 'OUTCOME_UNCERTAIN',
      message: 'error.request-timeout',
    })

    await vi.advanceTimersByTimeAsync(360_000)
    await assertion
    expect(requestSignal?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new URL(String((fetchMock.mock.calls[0] as unknown as [unknown])[0])).pathname).toBe('/api/repo/clone')
  })

  test('does not impose a client watchdog on remove-worktree', async () => {
    useFakeTimers()
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const caller = new AbortController()
    let requestSignal: AbortSignal | undefined
    const requestStarted = Promise.withResolvers<void>()
    mockFetch((_url, init) => {
      requestSignal = (init as RequestInit | undefined)?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true })
        requestStarted.resolve()
      })
    })

    const { removeRepoWorktree } = await import('#/web/repos/client.ts')
    const request = removeRepoWorktree(
      workspaceId,
      'repo-runtime-test',
      {
        branch: 'feature/remove',
        worktreePath: '/tmp/repo-feature-remove',
        deleteBranch: true,
        deleteUpstream: true,
      },
      caller.signal,
    )

    await requestStarted.promise
    if (!requestSignal) throw new Error('missing remove-worktree request signal')
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1)
    expect(requestSignal.aborted).toBe(false)

    caller.abort(new Error('caller cancelled'))
    await expect(request).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' })
  })

  test('classifies create-worktree cancellation after delivery as uncertain rather than timeout', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const caller = new AbortController()
    mockFetch((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    const { createRepoWorktree } = await import('#/web/repos/client.ts')
    const request = createRepoWorktree(
      workspaceId,
      'repo-runtime-test',
      {
        worktreePath: '/tmp/repo-feature',
        mode: { kind: 'newBranch', newBranch: 'feature/work', baseRef: 'main' },
      },
      { kind: 'skip' },
      caller.signal,
    )
    caller.abort(new Error('caller cancelled'))

    await expect(request).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' })
  })

  test('does not impose the former client watchdog on create-worktree', async () => {
    useFakeTimers()
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const caller = new AbortController()
    let requestSignal: AbortSignal | undefined
    const requestStarted = Promise.withResolvers<void>()
    mockFetch((_url, init) => {
      requestSignal = (init as RequestInit | undefined)?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true })
        requestStarted.resolve()
      })
    })

    const { createRepoWorktree } = await import('#/web/repos/client.ts')
    const request = createRepoWorktree(
      workspaceId,
      'repo-runtime-test',
      {
        worktreePath: '/tmp/repo-feature',
        mode: { kind: 'newBranch', newBranch: 'feature/work', baseRef: 'main' },
      },
      { kind: 'skip' },
      caller.signal,
    )

    await requestStarted.promise
    if (!requestSignal) throw new Error('missing create-worktree request signal')
    await vi.advanceTimersByTimeAsync(15 * 60_000 + 1)
    expect(requestSignal.aborted).toBe(false)

    caller.abort(new Error('caller cancelled'))
    await expect(request).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' })
  })

  test('gives patch generation an explicit long-read request budget', async () => {
    useFakeTimers()
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    let requestSignal: AbortSignal | undefined
    const requestStarted = Promise.withResolvers<void>()
    mockFetch((_url, init) => {
      requestSignal = (init as RequestInit | undefined)?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true })
        requestStarted.resolve()
      })
    })

    const { getRepoPatch } = await import('#/web/repos/client.ts')
    const request = getRepoPatch(workspaceId, 'repo-runtime-test', '/tmp/repo-feature')
    const assertion = expect(request).rejects.toThrow('error.request-timeout')

    await requestStarted.promise
    if (!requestSignal) throw new Error('missing patch request signal')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(requestSignal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(780_000)
    await assertion
  })

  test('throws when repository log returns an error envelope', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({ ok: false, message: 'error.failed-read-repo' }),
    }))
    const { getRepoLog } = await import('#/web/repos/client.ts')
    await expect(
      getRepoLog(workspaceId, 'repo-runtime-test', { kind: 'branch', branchName: 'feature/work' }),
    ).rejects.toThrow('error.failed-read-repo')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/log',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({
          cwd: workspaceId,
          workspaceRuntimeId: 'repo-runtime-test',
          target: { kind: 'branch', branchName: 'feature/work' },
          count: 100,
          skip: 0,
        }),
      }),
    )
  })

  test('opens external workspace apps through server routes', async () => {
    const fetchMock = mockFetch(
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: 'server-terminal' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: 'server-editor' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: 'server-finder' }) }),
    )
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __GOBLIN_BOOTSTRAP__: webBootstrap({
          initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
        }),

        location: {
          href: 'http://127.0.0.1:32100/',
          origin: 'http://127.0.0.1:32100',
          search: '',
        },
        matchMedia: vi.fn(() => ({ matches: true })),
      },
    })
    const { openWorkspaceEditor, openWorkspaceInFinder, openWorkspaceTerminal } =
      await import('#/web/external-apps/workspace-client.ts')
    await expect(openWorkspaceTerminal(executionTarget, 'ghostty')).resolves.toEqual({
      ok: true,
      message: 'server-terminal',
    })
    await expect(openWorkspaceEditor(executionTarget, 'vscode')).resolves.toEqual({
      ok: true,
      message: 'server-editor',
    })
    await expect(openWorkspaceInFinder(executionTarget)).resolves.toEqual({
      ok: true,
      message: 'server-finder',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:32100/api/workspace/open-terminal',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({ target: executionTarget, app: 'ghostty' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:32100/api/workspace/open-editor',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({ target: executionTarget, app: 'vscode' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://127.0.0.1:32100/api/workspace/open-in-finder',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({ target: executionTarget }),
      }),
    )
  })

  test('sends explicit external app choices in open route bodies', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const fetchMock = mockFetch(
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: 'server-terminal' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: 'server-editor' }) }),
    )
    const { openWorkspaceEditor, openWorkspaceTerminal } = await import('#/web/external-apps/workspace-client.ts')
    await openWorkspaceTerminal(executionTarget, 'ghostty')
    await openWorkspaceEditor(executionTarget, 'vscode')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:32100/api/workspace/open-terminal',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ target: executionTarget, app: 'ghostty' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:32100/api/workspace/open-editor',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ target: executionTarget, app: 'vscode' }),
      }),
    )
  })
})
