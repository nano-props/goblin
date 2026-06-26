import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createServerSettingsState } from '#/server/modules/settings-state.ts'

const mocks = vi.hoisted(() => ({
  getServerExternalAppsSnapshot: vi.fn(),
  getServerGitHubCliState: vi.fn(),
  getSettingsSnapshot: vi.fn(),
  getServerSettingsPrefs: vi.fn(),
  applyServerFetchIntervalWrite: vi.fn(),
  applyServerGlobalShortcutRegistrationWrite: vi.fn(),
  applyServerRecentRepoAddWrite: vi.fn(),
  applyServerRecentRepoClearWrite: vi.fn(),
  applyServerSessionWrite: vi.fn(),
  applyServerSettingsPrefsWrite: vi.fn(),
}))

vi.mock('#/server/modules/external-apps.ts', () => ({
  getServerExternalAppsSnapshot: mocks.getServerExternalAppsSnapshot,
}))

vi.mock('#/server/modules/github-cli.ts', () => ({
  getServerGitHubCliState: mocks.getServerGitHubCliState,
}))

vi.mock('#/server/modules/settings-snapshot.ts', () => ({
  getSettingsSnapshot: mocks.getSettingsSnapshot,
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerSettingsPrefs: mocks.getServerSettingsPrefs,
}))

vi.mock('#/server/modules/settings-write-paths.ts', () => ({
  applyServerFetchIntervalWrite: mocks.applyServerFetchIntervalWrite,
  applyServerGlobalShortcutRegistrationWrite: mocks.applyServerGlobalShortcutRegistrationWrite,
  applyServerRecentRepoAddWrite: mocks.applyServerRecentRepoAddWrite,
  applyServerRecentRepoClearWrite: mocks.applyServerRecentRepoClearWrite,
  applyServerSessionWrite: mocks.applyServerSessionWrite,
  applyServerSettingsPrefsWrite: mocks.applyServerSettingsPrefsWrite,
}))

describe('settings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('delegates prefs writes to the settings write-path application layer', async () => {
    mocks.applyServerSettingsPrefsWrite.mockResolvedValue({
      ok: true,
      settings: { lang: 'ja' },
      i18n: { lang: 'ja', pref: 'ja', dict: {} },
    })

    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(createServerSettingsState())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/prefs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-language': 'ja-JP,ja;q=0.9,en;q=0.8',
        },
        body: JSON.stringify({ settings: { lang: 'ja' } }),
      }),
    )

    await expect(response.json()).resolves.toEqual({
      ok: true,
      settings: { lang: 'ja' },
      i18n: { lang: 'ja', pref: 'ja', dict: {} },
    })
    expect(mocks.applyServerSettingsPrefsWrite).toHaveBeenCalledWith(
      { settings: { lang: 'ja' } },
      { acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.8', signal: expect.any(AbortSignal) },
    )
  })

  test('delegates session writes to the settings write-path application layer', async () => {
    const session = {
      openRepos: [],
      activeRepo: null,
      workspaceFocused: true,
      workspacePaneSize: 50,
      selectedTerminalByWorktree: {},
      workspacePaneTabOrderByBranchByRepo: {},
    } as const
    mocks.applyServerSessionWrite.mockResolvedValue({ ok: true, session })

    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(createServerSettingsState())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session }),
      }),
    )

    await expect(response.json()).resolves.toEqual({
      ok: true,
      session,
    })
    expect(mocks.applyServerSessionWrite).toHaveBeenCalledWith({ session })
  })

  test('delegates recent-repo writes to the settings write-path application layer', async () => {
    const repo = { kind: 'local', id: '/tmp/repo-a' } as const
    mocks.applyServerRecentRepoAddWrite.mockResolvedValue({ ok: true, recentRepos: [repo], addedRepo: repo })
    mocks.applyServerRecentRepoClearWrite.mockResolvedValue({ ok: true })
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(createServerSettingsState())

    const addResponse = await app.request(
      new Request('http://127.0.0.1:32100/recent-repos/add', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo }),
      }),
    )
    await expect(addResponse.json()).resolves.toEqual({
      ok: true,
      recentRepos: [repo],
      addedRepo: repo,
    })
    expect(mocks.applyServerRecentRepoAddWrite).toHaveBeenCalledWith({ repo })

    const clearResponse = await app.request(
      new Request('http://127.0.0.1:32100/recent-repos/clear', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    await expect(clearResponse.json()).resolves.toEqual({ ok: true })
    expect(mocks.applyServerRecentRepoClearWrite).toHaveBeenCalled()
  })

  test('returns 400 BAD_REQUEST when the body is missing required fields', async () => {
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(createServerSettingsState())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/fetch-interval', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { ok: boolean; code: string }
    expect(json.code).toBe('BAD_REQUEST')
    expect(mocks.applyServerFetchIntervalWrite).not.toHaveBeenCalled()
  })

  test('returns 400 when global-shortcut-state body has wrong type for `registered`', async () => {
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(createServerSettingsState())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/global-shortcut-state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ registered: 'yes' }),
      }),
    )
    expect(response.status).toBe(400)
    expect(mocks.applyServerGlobalShortcutRegistrationWrite).not.toHaveBeenCalled()
  })

  test('delegates github-cli detection to the server module, scoping by hosts when provided', async () => {
    const state = {
      available: true,
      version: '2.93.0',
      detectedAt: 1,
      hosts: { 'github.example.com': { authed: true } },
    }
    mocks.getServerGitHubCliState.mockResolvedValue(state)
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(createServerSettingsState())

    const hostsResponse = await app.request(
      new Request('http://127.0.0.1:32100/github-cli', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hosts: ['github.example.com'] }),
      }),
    )
    await expect(hostsResponse.json()).resolves.toEqual(state)
    expect(mocks.getServerGitHubCliState).toHaveBeenLastCalledWith(expect.any(AbortSignal), ['github.example.com'])

    const emptyResponse = await app.request(
      new Request('http://127.0.0.1:32100/github-cli', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    await expect(emptyResponse.json()).resolves.toEqual(state)
    expect(mocks.getServerGitHubCliState).toHaveBeenLastCalledWith(expect.any(AbortSignal), undefined)
  })

  test('returns 400 when hosts is a string instead of an array', async () => {
    // Schema is `v.optional(v.array(v.string()))`. The previous
    // query-string mode coerced query values to strings, so this
    // shape was unreachable; POST body makes it possible to send
    // a bare string and now the schema must reject it.
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(createServerSettingsState())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/github-cli', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hosts: 'github.example.com' }),
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { code: string }
    expect(json.code).toBe('BAD_REQUEST')
    expect(mocks.getServerGitHubCliState).not.toHaveBeenCalled()
  })
})
