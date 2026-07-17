import { Hono } from 'hono'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createNativeShortcutRegistrationState } from '#/server/modules/native-shortcut-registration.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'

const mocks = vi.hoisted(() => ({
  getServerExternalAppsSnapshot: vi.fn(),
  getServerGitHubCliState: vi.fn(),
  getSettingsSnapshot: vi.fn(),
  getUserSettings: vi.fn(),
  handleSetFetchInterval: vi.fn(),
  handleSetGlobalShortcutRegistered: vi.fn(),
  handleAddRecentWorkspace: vi.fn(),
  handleClearRecentWorkspaces: vi.fn(),
  handleUpdateUserSettings: vi.fn(),
  restoreServerWorkspace: vi.fn(),
  restoreRepoTabsForRepo: vi.fn(),
  addServerWorkspaceRepo: vi.fn(),
  removeServerWorkspaceRepo: vi.fn(),
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
  getUserSettings: mocks.getUserSettings,
  addServerWorkspaceRepo: mocks.addServerWorkspaceRepo,
  removeServerWorkspaceRepo: mocks.removeServerWorkspaceRepo,
}))

vi.mock('#/server/modules/settings-write-paths.ts', () => ({
  handleSetFetchInterval: mocks.handleSetFetchInterval,
  handleSetGlobalShortcutRegistered: mocks.handleSetGlobalShortcutRegistered,
  handleAddRecentWorkspace: mocks.handleAddRecentWorkspace,
  handleClearRecentWorkspaces: mocks.handleClearRecentWorkspaces,
  handleUpdateUserSettings: mocks.handleUpdateUserSettings,
}))

vi.mock('#/server/modules/session-restore.ts', () => ({
  restoreServerWorkspace: mocks.restoreServerWorkspace,
}))

vi.mock('#/server/modules/repo-workspace-tabs-restore.ts', () => ({
  restoreRepoTabsForRepo: mocks.restoreRepoTabsForRepo,
}))

const workspacePaneTabsHostStub = {
  restoreTabs: vi.fn(async () => ({
    kind: 'restored' as const,
    snapshot: { revision: 0, entries: [] },
    repaired: false,
  })),
  listWorkspaceTabs: vi.fn(),
  replaceTabs: vi.fn(),
  updateTabs: vi.fn(),
} satisfies ServerWorkspacePaneTabsHost

const TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST = { removeGitScopedResources: vi.fn() }

function settingsRouteOptions() {
  return {
    settingsState: createNativeShortcutRegistrationState(),
    workspacePaneTabsHost: workspacePaneTabsHostStub,
    workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
  }
}

describe('settings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('delegates prefs writes to the settings command handler layer', async () => {
    mocks.handleUpdateUserSettings.mockResolvedValue({
      ok: true,
      prefs: { lang: 'ja' },
      i18n: { lang: 'ja', pref: 'ja', dict: {} },
    })

    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/prefs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-language': 'ja-JP,ja;q=0.9,en;q=0.8',
        },
        body: JSON.stringify({ prefs: { lang: 'ja' } }),
      }),
    )

    await expect(response.json()).resolves.toEqual({
      ok: true,
      prefs: { lang: 'ja' },
      i18n: { lang: 'ja', pref: 'ja', dict: {} },
    })
    expect(mocks.handleUpdateUserSettings).toHaveBeenCalledWith(
      { prefs: { lang: 'ja' } },
      { acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.8', signal: expect.any(AbortSignal) },
    )
  })

  test('delegates session restore to the server restore coordinator', async () => {
    const restored = {
      status: 'restored' as const,
      openWorkspaceEntries: [],
      runtime: { repos: [], workspacePaneTabs: [], restoredRepoId: null },
    }
    mocks.restoreServerWorkspace.mockResolvedValue(restored)
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = new Hono<{ Variables: { userId: string } }>()
    app.use('*', async (c, next) => {
      c.set('userId', 'user-test')
      await next()
    })
    app.route('/', createSettingsRoutes(settingsRouteOptions()))

    const response = await app.request(
      new Request('http://127.0.0.1:32100/workspace/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: 'client_test000000000000',
          activeRepoRoot: 'goblin+file:///repo-active',
        }),
      }),
    )

    await expect(response.json()).resolves.toEqual(restored)
    expect(mocks.restoreServerWorkspace).toHaveBeenCalledWith({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      activeRepoRoot: 'goblin+file:///repo-active',
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      signal: expect.any(AbortSignal),
    })
  })

  test('discards an invalid active workspace hint without blocking authoritative workspace restore', async () => {
    const restored = {
      status: 'repaired' as const,
      openWorkspaceEntries: [],
      runtime: { repos: [], workspacePaneTabs: [], restoredRepoId: null },
    }
    mocks.restoreServerWorkspace.mockResolvedValue(restored)
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = new Hono<{ Variables: { userId: string } }>()
    app.use('*', async (c, next) => {
      c.set('userId', 'user-test')
      await next()
    })
    app.route('/', createSettingsRoutes(settingsRouteOptions()))

    const response = await app.request('/workspace/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client_test000000000000',
        activeRepoRoot: '/stale/native/path',
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(restored)
    expect(mocks.restoreServerWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ activeRepoRoot: null }),
    )
  })

  test('delegates authenticated workspace membership commands', async () => {
    const workspace = {
      openWorkspaceEntries: [{ kind: 'local' as const, id: 'goblin+file:///repo-a' }],
      workspacePaneTabsByTargetByWorkspace: {},
    }
    mocks.addServerWorkspaceRepo.mockResolvedValue(workspace)
    mocks.removeServerWorkspaceRepo.mockResolvedValue({ ...workspace, openWorkspaceEntries: [] })
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = new Hono<{ Variables: { userId: string } }>()
    app.use('*', async (c, next) => {
      c.set('userId', 'user-test')
      await next()
    })
    app.route('/', createSettingsRoutes(settingsRouteOptions()))

    const addResponse = await app.request('/workspace/repos/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entry: { kind: 'local', id: 'goblin+file:///repo-a' } }),
    })
    const removeResponse = await app.request('/workspace/repos/remove', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot: 'goblin+file:///repo-a' }),
    })

    await expect(addResponse.json()).resolves.toEqual(workspace)
    await expect(removeResponse.json()).resolves.toEqual({ ...workspace, openWorkspaceEntries: [] })
    expect(mocks.addServerWorkspaceRepo).toHaveBeenCalledWith({ kind: 'local', id: 'goblin+file:///repo-a' })
    expect(mocks.removeServerWorkspaceRepo).toHaveBeenCalledWith('goblin+file:///repo-a')
  })

  test('delegates lazy repo tab restore to the server restore coordinator', async () => {
    const restored = {
      repo: {
        entry: { kind: 'local' as const, id: 'goblin+file:///repo-active' },
        repoRoot: 'goblin+file:///repo-active',
        repoRuntimeId: 'repo_runtime_test',
        name: 'repo-active',
        projection: {
          snapshot: { current: 'main', branches: [] },
          pullRequests: null,
          operations: { operations: [], loadedAt: 0 },
          requested: { branch: null, pullRequestMode: 'full' as const },
          loadedAt: 1,
        },
      },
      snapshot: null,
    }
    mocks.restoreRepoTabsForRepo.mockResolvedValue(restored)
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = new Hono<{ Variables: { userId: string } }>()
    app.use('*', async (c, next) => {
      c.set('userId', 'user-test')
      await next()
    })
    app.route('/', createSettingsRoutes(settingsRouteOptions()))

    const response = await app.request(
      new Request('http://127.0.0.1:32100/workspace/restore-repo-tabs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: 'client_test000000000000',
          repoRoot: 'goblin+file:///repo-active',
          repoRuntimeId: 'repo_runtime_test',
        }),
      }),
    )

    await expect(response.json()).resolves.toEqual(restored)
    expect(mocks.restoreRepoTabsForRepo).toHaveBeenCalledWith({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      repoRoot: 'goblin+file:///repo-active',
      repoRuntimeId: 'repo_runtime_test',
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      signal: expect.any(AbortSignal),
    })
  })

  test('rejects session restore without an authenticated user id', async () => {
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())

    const response = await app.request(
      new Request('http://127.0.0.1:32100/workspace/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: 'client_test000000000000' }),
      }),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ ok: false, message: 'Unauthorized' })
    expect(mocks.restoreServerWorkspace).not.toHaveBeenCalled()
  })

  test('rejects session restore when client id is invalid', async () => {
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = new Hono<{ Variables: { userId: string } }>()
    app.use('*', async (c, next) => {
      c.set('userId', 'user-test')
      await next()
    })
    app.route('/', createSettingsRoutes(settingsRouteOptions()))

    const response = await app.request(
      new Request('http://127.0.0.1:32100/workspace/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )

    expect(response.status).toBe(400)
    const json = (await response.json()) as { code: string }
    expect(json.code).toBe('BAD_REQUEST')
    expect(mocks.restoreServerWorkspace).not.toHaveBeenCalled()
  })

  test('delegates recent-repo writes to the settings command handler layer', async () => {
    const repo = { kind: 'local', id: 'goblin+file:///tmp/repo-a' } as const
    mocks.handleAddRecentWorkspace.mockResolvedValue({ ok: true, recentWorkspaces: [repo], addedRepo: repo })
    mocks.handleClearRecentWorkspaces.mockResolvedValue({ ok: true })
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())

    const addResponse = await app.request(
      new Request('http://127.0.0.1:32100/recent-workspaces/add', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo }),
      }),
    )
    await expect(addResponse.json()).resolves.toEqual({
      ok: true,
      recentWorkspaces: [repo],
      addedRepo: repo,
    })
    expect(mocks.handleAddRecentWorkspace).toHaveBeenCalledWith({ repo })

    const clearResponse = await app.request(
      new Request('http://127.0.0.1:32100/recent-workspaces/clear', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    await expect(clearResponse.json()).resolves.toEqual({ ok: true })
    expect(mocks.handleClearRecentWorkspaces).toHaveBeenCalled()
  })

  test('returns 400 BAD_REQUEST when the body is missing required fields', async () => {
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())
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
    expect(mocks.handleSetFetchInterval).not.toHaveBeenCalled()
  })

  test('returns 400 when global-shortcut-state body has wrong type for `registered`', async () => {
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/global-shortcut-state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ registered: 'yes' }),
      }),
    )
    expect(response.status).toBe(400)
    expect(mocks.handleSetGlobalShortcutRegistered).not.toHaveBeenCalled()
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
    const app = createSettingsRoutes(settingsRouteOptions())

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
    const app = createSettingsRoutes(settingsRouteOptions())
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
