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
  handleSetWorkspaceExternalAppRecent: vi.fn(),
  handleUpdateUserSettings: vi.fn(),
  restoreServerWorkspace: vi.fn(),
  restoreWorkspaceTabs: vi.fn(),
  addServerWorkspaceEntry: vi.fn(),
  removeServerWorkspaceEntry: vi.fn(),
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
  addServerWorkspaceEntry: mocks.addServerWorkspaceEntry,
  removeServerWorkspaceEntry: mocks.removeServerWorkspaceEntry,
}))

vi.mock('#/server/modules/settings-write-paths.ts', () => ({
  handleSetFetchInterval: mocks.handleSetFetchInterval,
  handleSetGlobalShortcutRegistered: mocks.handleSetGlobalShortcutRegistered,
  handleAddRecentWorkspace: mocks.handleAddRecentWorkspace,
  handleClearRecentWorkspaces: mocks.handleClearRecentWorkspaces,
  handleSetWorkspaceExternalAppRecent: mocks.handleSetWorkspaceExternalAppRecent,
  handleUpdateUserSettings: mocks.handleUpdateUserSettings,
}))

vi.mock('#/server/modules/session-restore.ts', () => ({
  restoreServerWorkspace: mocks.restoreServerWorkspace,
}))

vi.mock('#/server/modules/workspace-tabs-restore.ts', () => ({
  restoreWorkspaceTabs: mocks.restoreWorkspaceTabs,
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

const TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST = {
  commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'committed' as const })),
}

function settingsRouteOptions() {
  return {
    settingsState: createNativeShortcutRegistrationState(),
    workspacePaneTabsHost: workspacePaneTabsHostStub,
    workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
    serverHost: '127.0.0.1',
    serverPort: 32100,
  }
}

describe('settings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('reports the injected runtime endpoint instead of re-reading environment configuration', async () => {
    const previousHost = process.env.GOBLIN_SERVER_HOST
    const previousPort = process.env.GOBLIN_SERVER_PORT
    process.env.GOBLIN_SERVER_HOST = '0.0.0.0'
    process.env.GOBLIN_SERVER_PORT = '70000'
    try {
      const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
      const app = createSettingsRoutes({ ...settingsRouteOptions(), serverHost: '127.0.0.1', serverPort: 33241 })

      const response = await app.request('/lan')

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ host: '127.0.0.1', port: 33241, lanUrls: [] })
    } finally {
      if (previousHost === undefined) delete process.env.GOBLIN_SERVER_HOST
      else process.env.GOBLIN_SERVER_HOST = previousHost
      if (previousPort === undefined) delete process.env.GOBLIN_SERVER_PORT
      else process.env.GOBLIN_SERVER_PORT = previousPort
    }
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
      runtime: { repos: [], workspacePaneTabs: [], restoredWorkspaceId: null },
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
          activeWorkspaceId: 'goblin+file:///repo-active',
        }),
      }),
    )

    await expect(response.json()).resolves.toEqual(restored)
    expect(mocks.restoreServerWorkspace).toHaveBeenCalledWith({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      activeWorkspaceId: 'goblin+file:///repo-active',
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      workspaceCapabilityTransitionHost: TEST_WORKSPACE_CAPABILITY_TRANSITION_HOST,
      signal: expect.any(AbortSignal),
    })
  })

  test('delegates authenticated workspace membership commands', async () => {
    const workspace = {
      openWorkspaceEntries: [{ id: 'goblin+file:///repo-a' }],
      workspacePaneTabsByTargetByWorkspace: {},
    }
    mocks.addServerWorkspaceEntry.mockResolvedValue(workspace)
    mocks.removeServerWorkspaceEntry.mockResolvedValue({ ...workspace, openWorkspaceEntries: [] })
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = new Hono<{ Variables: { userId: string } }>()
    app.use('*', async (c, next) => {
      c.set('userId', 'user-test')
      await next()
    })
    app.route('/', createSettingsRoutes(settingsRouteOptions()))

    const addResponse = await app.request('/workspace/entries/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entry: { id: 'goblin+file:///repo-a' } }),
    })
    const removeResponse = await app.request('/workspace/entries/remove', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'goblin+file:///repo-a' }),
    })

    await expect(addResponse.json()).resolves.toEqual(workspace)
    await expect(removeResponse.json()).resolves.toEqual({ ...workspace, openWorkspaceEntries: [] })
    expect(mocks.addServerWorkspaceEntry).toHaveBeenCalledWith({ id: 'goblin+file:///repo-a' })
    expect(mocks.removeServerWorkspaceEntry).toHaveBeenCalledWith('goblin+file:///repo-a')
  })

  test('delegates lazy repo tab restore to the server restore coordinator', async () => {
    const restored = {
      repo: {
        entry: { id: 'goblin+file:///repo-active' },
        repoRoot: 'goblin+file:///repo-active',
        workspaceRuntimeId: 'repo_runtime_test',
        name: 'repo-active',
        gitProjection: {
          snapshot: { current: 'main', branches: [] },
          pullRequests: null,
          requested: { branch: null, pullRequestMode: 'full' as const },
          loadedAt: 1,
        },
      },
      snapshot: null,
    }
    mocks.restoreWorkspaceTabs.mockResolvedValue(restored)
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = new Hono<{ Variables: { userId: string } }>()
    app.use('*', async (c, next) => {
      c.set('userId', 'user-test')
      await next()
    })
    app.route('/', createSettingsRoutes(settingsRouteOptions()))

    const response = await app.request(
      new Request('http://127.0.0.1:32100/workspace/tabs/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: 'client_test000000000000',
          workspaceId: 'goblin+file:///repo-active',
          workspaceRuntimeId: 'repo_runtime_test',
        }),
      }),
    )

    await expect(response.json()).resolves.toEqual(restored)
    expect(mocks.restoreWorkspaceTabs).toHaveBeenCalledWith({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      workspaceId: 'goblin+file:///repo-active',
      workspaceRuntimeId: 'repo_runtime_test',
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

  test('delegates recent-workspace writes to the settings command handler layer', async () => {
    const repo = { id: 'goblin+file:///tmp/repo-a' }
    mocks.handleAddRecentWorkspace.mockResolvedValue({ ok: true, recentWorkspaces: [repo], addedWorkspace: repo })
    mocks.handleClearRecentWorkspaces.mockResolvedValue({ ok: true })
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())

    const addResponse = await app.request(
      new Request('http://127.0.0.1:32100/recent-workspaces/add', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: repo }),
      }),
    )
    await expect(addResponse.json()).resolves.toEqual({
      ok: true,
      recentWorkspaces: [repo],
      addedWorkspace: repo,
    })
    expect(mocks.handleAddRecentWorkspace).toHaveBeenCalledWith({ workspace: repo })

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

  test.each([-1, 1.5, 3601])('rejects invalid fetch interval %s at command admission', async (sec) => {
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/fetch-interval', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sec }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.handleSetFetchInterval).not.toHaveBeenCalled()
  })

  test('rejects a reserved global shortcut at command admission', async () => {
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/prefs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefs: { globalShortcut: 'Control+O' } }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.handleUpdateUserSettings).not.toHaveBeenCalled()
  })

  test('rejects a non-canonical external-app target at command admission', async () => {
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/workspace-external-app-recent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'goblin+file:///repo',
          targetKey: 'git-worktree\0relative/path',
          itemId: 'editor:vscode',
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.handleSetWorkspaceExternalAppRecent).not.toHaveBeenCalled()
  })

  test('rejects an unknown external-app item at command admission', async () => {
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/workspace-external-app-recent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'goblin+file:///repo',
          targetKey: 'workspace-root',
          itemId: 'editor:unknown',
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.handleSetWorkspaceExternalAppRecent).not.toHaveBeenCalled()
  })
})
