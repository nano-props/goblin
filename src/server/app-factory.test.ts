import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ServerAppRealtimeHost } from '#/server/realtime/app-realtime-host.ts'
import type {
  ServerWorkspacePaneTabsHost,
  ServerWorkspacePaneTargetLifecycleHost,
} from '#/server/workspace-pane/workspace-pane-tabs-host.ts'

const mocks = vi.hoisted(() => ({
  access: vi.fn(async () => undefined),
  readFile: vi.fn(
    async () => `<!doctype html>
<html lang="en">
  <head>
    <script type="module" src="/boot.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`,
  ),
  existsSync: vi.fn(() => true),
  getUserSettings: vi.fn(async () => ({
    lang: 'auto',
    theme: 'auto',
    colorTheme: 'macos',
    fetchIntervalSec: 120,
    terminalNotificationsEnabled: false,
    shortcutsDisabled: false,
    globalShortcutDisabled: false,
    globalShortcut: 'CommandOrControl+Shift+G',
    lanEnabled: false,
  })),
}))

const appRealtimeHostStub = {
  isValidClientId: (_value: unknown): _value is string => true,
  getDiagnostics: vi.fn(() => ({
    terminal: {
      mode: 'in-process' as const,
      state: 'running' as const,
      registeredSockets: 0,
      shuttingDown: false,
      pty: {
        mode: 'in-process' as const,
        state: 'running' as const,
        workerRunning: false,
        workerPid: null,
        workerStartedAt: null,
        workerUptimeMs: null,
        pendingRequests: 0,
        restartAttempts: 0,
        restartScheduled: false,
        shuttingDown: false,
        lastSuccessfulResponseAt: null,
        lastExitCode: null,
        lastExitSignal: null,
        lastFailure: null,
      },
      liveSessionCount: 0,
      totalRingBufferChars: 0,
      maxRingBufferChars: 0,
    },
  })),
  registerSocket: vi.fn(),
  unregisterSocket: vi.fn(),
  handleRealtimeMessage: vi.fn(),
  shutdown: vi.fn(),
} satisfies ServerAppRealtimeHost

const workspacePaneTabsHostStub = {
  restoreTabs: vi.fn(async () => ({ kind: 'restored' as const, snapshot: { revision: 0, entries: [] } })),
  listWorkspaceTabs: vi.fn(),
  replaceTabs: vi.fn(),
  updateTabs: vi.fn(),
  retireTarget: vi.fn(),
} satisfies ServerWorkspacePaneTabsHost & ServerWorkspacePaneTargetLifecycleHost

const worktreeRemovalApplicationStub = {
  removeWorktree: vi.fn(async () => ({ ok: false as const, message: 'unused' })),
}

// The clipboard write-paths module imports mkdir / writeFile /
// readdir / rm from node:fs/promises. The earlier two-method mock
// silently turned them into `undefined`, which made the new
// `with valid multipart` route test explode with 500. Pass them
// through to the real module so disk operations work in this
// file's integration-style tests.
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    access: mocks.access,
    readFile: mocks.readFile,
    mkdir: actual.mkdir,
    writeFile: actual.writeFile,
    readdir: actual.readdir,
    rm: actual.rm,
  }
})

// The HTML-serve tests want the SPA fallback (`dist/web/index.html`
// for deep links) to actually run. Pretend the build exists so the
// middleware + catch-all register, and let `readFile` return the
// fake HTML above. Tests that don't care can rely on the catch-all
// skipping when `existsSync` returns false.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    existsSync: mocks.existsSync,
  }
})

vi.mock('#/server/modules/settings-source.ts', () => ({
  getUserSettings: mocks.getUserSettings,
}))

describe('server app body limit', () => {
  test('rejects POST bodies over 1 MiB with a 413 JSON response', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      accessToken: 'secret',
      appRealtimeHost: appRealtimeHostStub,
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      worktreeRemovalApplication: worktreeRemovalApplicationStub,
    })
    const oversized = 'x'.repeat(2 * 1024 * 1024)
    const response = await app.request(
      new Request('http://127.0.0.1:32100/api/settings/prefs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goblin-access-token': 'secret',
        },
        body: JSON.stringify({ session: { blob: oversized } }),
      }),
    )
    expect(response.status).toBe(413)
    const json = (await response.json()) as { ok: boolean; code: string }
    expect(json).toEqual({ ok: false, code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' })
  })

  test('accepts POST bodies under the limit and surfaces route errors normally', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      accessToken: 'secret',
      appRealtimeHost: appRealtimeHostStub,
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      worktreeRemovalApplication: worktreeRemovalApplicationStub,
    })
    // A small, well-formed body: validation will run after the body
    // limit middleware, so we expect 400 (BAD_REQUEST) — not 413.
    const response = await app.request(
      new Request('http://127.0.0.1:32100/api/settings/prefs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goblin-access-token': 'secret',
        },
        body: JSON.stringify({}),
      }),
    )
    expect(response.status).toBe(400)
  })
})

describe('server app html static', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  test('uses no-store for entry files and immutable caching for hashed assets', async () => {
    const { webStaticCacheControl } = await import('#/server/app-factory.ts')

    expect(webStaticCacheControl('/index.html', new Response('', { headers: { 'content-type': 'text/html' } }))).toBe(
      'no-store',
    )
    expect(
      webStaticCacheControl('/boot.js', new Response('', { headers: { 'content-type': 'text/javascript' } })),
    ).toBe('no-store')
    expect(
      webStaticCacheControl(
        '/assets/index-abc123.js',
        new Response('', { headers: { 'content-type': 'text/javascript' } }),
      ),
    ).toBe('public, max-age=31536000, immutable')
    expect(
      webStaticCacheControl('/assets/missing.js', new Response('', { headers: { 'content-type': 'text/html' } })),
    ).toBe('no-store')
    expect(webStaticCacheControl('/assets/missing.js', new Response('', { status: 404 }))).toBe('no-store')
  })

  test('does not immutable-cache SPA fallback responses for missing asset paths', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      accessToken: 'secret',
      appRealtimeHost: appRealtimeHostStub,
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      worktreeRemovalApplication: worktreeRemovalApplicationStub,
    })

    const response = await app.request(new Request('http://127.0.0.1:32100/assets/missing-old-build.js'))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(html).toContain('<div id="root"></div>')
    expect(response.headers.get('content-type')).toMatch(/text\/html/)
  })

  test('serves the index html as plain static (no bootstrap injection, no token)', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      accessToken: 'secret',
      appRealtimeHost: appRealtimeHostStub,
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      worktreeRemovalApplication: worktreeRemovalApplicationStub,
    })

    const response = await app.request(
      new Request('http://127.0.0.1:32100/', {
        headers: {
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      }),
    )

    const html = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    // The HTML is the raw dist/web/index.html (mocked above) with
    // no `<script id="goblin-bootstrap">` injection and no token in
    // the response. The client reads i18n from
    // `/api/i18n` and the access token either from the
    // Electron preload's IPC or the `/api/login` cookie.
    expect(html).not.toContain('goblin-bootstrap')
    expect(html).not.toContain('"accessToken"')
    expect(html).not.toContain('"secret"')
    expect(html).toContain('<div id="root"></div>')
  })

  test('serves static html for frontend route refreshes', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      accessToken: 'secret',
      appRealtimeHost: appRealtimeHostStub,
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      worktreeRemovalApplication: worktreeRemovalApplicationStub,
    })
    for (const path of ['/repos/abc123', '/repos/abc123/changes', '/settings', '/settings/general']) {
      const response = await app.request(new Request(`http://127.0.0.1:32100${path}`))
      const html = await response.text()
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(html).toContain('<div id="root"></div>')
      expect(html).not.toContain('goblin-bootstrap')
    }
  })

  test('exposes /api/host as a public, unauthenticated endpoint', async () => {
    // Host info is non-sensitive (home dir path + platform string)
    // and is needed by the client's settings page on first paint,
    // before the user clears the token gate. The endpoint therefore
    // must not require `x-goblin-access-token` or a session cookie.
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      accessToken: 'secret',
      appRealtimeHost: appRealtimeHostStub,
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      worktreeRemovalApplication: worktreeRemovalApplicationStub,
    })
    const response = await app.request(new Request('http://127.0.0.1:32100/api/host'))
    expect(response.status).toBe(200)
    const json = (await response.json()) as { homeDir: string; platform: string; hostname: string; pid: number }
    expect(json.homeDir).toBeTypeOf('string')
    expect(json.platform).toBeTypeOf('string')
    expect(json.hostname).toBeTypeOf('string')
    expect(json.pid).toBeTypeOf('number')
  })

  test('returns JSON 404 (not the SPA shell) for unknown /api paths', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      accessToken: 'secret',
      appRealtimeHost: appRealtimeHostStub,
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      worktreeRemovalApplication: worktreeRemovalApplicationStub,
    })
    const response = await app.request(new Request('http://127.0.0.1:32100/api/unknown'))
    expect(response.status).toBe(404)
    const json = (await response.json()) as { ok: false; code: string }
    expect(json).toEqual({ ok: false, code: 'NOT_FOUND', message: expect.any(String) })
    // Make sure the catch-all didn't accidentally serve the HTML
    // shell (it would contain the root div).
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
  })
})

describe('per-sub-path body limits and auth ordering', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    // The clipboard write-path module reads serverDataDir() to
    // pick the temp dir, which on macOS points under
    // ~/Library/Application Support/Goblin. Real-disk writes
    // there during a test would pollute the user's machine, so
    // point everything at a per-test scratch dir.
    const scratch = process.env['GOBLIN_SERVER_DATA_DIR']
    if (!scratch) {
      const os = require('node:os') as typeof import('node:os')
      const path = require('node:path') as typeof import('node:path')
      const fs = require('node:fs') as typeof import('node:fs')
      const dir = path.join(os.tmpdir(), `app-factory-test-${process.pid}-${Math.random().toString(36).slice(2)}`)
      fs.mkdirSync(dir, { recursive: true })
      vi.stubEnv('GOBLIN_SERVER_DATA_DIR', dir)
    }
  })

  test('unauth probe to /api/settings/* with oversized body sees 401, not 413', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      accessToken: 'secret',
      appRealtimeHost: appRealtimeHostStub,
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      worktreeRemovalApplication: worktreeRemovalApplicationStub,
    })
    // 5 MiB body — well over the 1 MiB cap; Content-Length is set.
    const response = await app.request(
      new Request('http://127.0.0.1:32100/api/settings/prefs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(5 * 1024 * 1024),
        },
        body: 'x'.repeat(5 * 1024 * 1024),
      }),
    )
    expect(response.status).toBe(401)
  })

  test('authed oversized body to /api/settings/* sees 413', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      accessToken: 'secret',
      appRealtimeHost: appRealtimeHostStub,
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      worktreeRemovalApplication: worktreeRemovalApplicationStub,
    })
    const response = await app.request(
      new Request('http://127.0.0.1:32100/api/settings/prefs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(5 * 1024 * 1024),
          'x-goblin-access-token': 'secret',
        },
        body: 'x'.repeat(5 * 1024 * 1024),
      }),
    )
    expect(response.status).toBe(413)
  })

  test('authed 8 MiB body to /api/clipboard/* with valid multipart is processed by the route', async () => {
    // The previous version of this test asserted only `not.toBe(413)`,
    // which would pass even if the bodyLimit was broken (returning 200
    // from a junk body) or the route was broken (returning 500). It
    // didn't actually exercise the success path. Replace it with a
    // real multipart payload that the route will process. The write
    // module is not mocked here — Hono's app.request() runs through
    // the real write-paths module, which on a clean data dir writes
    // to disk and returns absolute paths. The test asserts the route
    // is reached *and* the bodyLimit doesn't pre-empt it.
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      accessToken: 'secret',
      appRealtimeHost: appRealtimeHostStub,
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      worktreeRemovalApplication: worktreeRemovalApplicationStub,
    })
    const form = new FormData()
    form.append('files', new File([new Uint8Array(8 * 1024 * 1024)], 'a.bin'))
    const response = await app.request(
      new Request('http://127.0.0.1:32100/api/clipboard/files', {
        method: 'POST',
        headers: { 'x-goblin-access-token': 'secret' },
        body: form,
      }),
    )
    expect(response.status).toBe(200)
    const json = (await response.json()) as { paths: string[] }
    expect(json.paths).toHaveLength(1)
    expect(json.paths[0]).toContain('clipboard-tmp-')
  })

  test('authed 8 MiB body to /api/clipboard/* with octet-stream (non-multipart) reaches the route and is rejected there', async () => {
    // Verifies the bodyLimit is *not* what rejects non-multipart
    // bodies — the route layer's BAD_REQUEST is. This is the
    // contract that protects the worker from a hostile client
    // that strips the multipart boundary to claim a smaller
    // Content-Length and then streams the body in a different
    // Content-Type. The route is the second line of defence.
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      accessToken: 'secret',
      appRealtimeHost: appRealtimeHostStub,
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      worktreeRemovalApplication: worktreeRemovalApplicationStub,
    })
    const response = await app.request(
      new Request('http://127.0.0.1:32100/api/clipboard/files', {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(8 * 1024 * 1024),
          'x-goblin-access-token': 'secret',
        },
        body: 'x'.repeat(8 * 1024 * 1024),
      }),
    )
    // c.req.parseBody throws on a non-multipart body, the route
    // returns BAD_REQUEST (400). Anything other than 413 proves
    // the bodyLimit let the request through.
    expect(response.status).toBe(400)
    const json = (await response.json()) as { ok: false; code: string }
    expect(json.code).toBe('BAD_REQUEST')
  })

  test('/api/clipboard/* still rejects bodies larger than the 12 MiB batch cap with 413', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      accessToken: 'secret',
      appRealtimeHost: appRealtimeHostStub,
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      worktreeRemovalApplication: worktreeRemovalApplicationStub,
    })
    const response = await app.request(
      new Request('http://127.0.0.1:32100/api/clipboard/files', {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(20 * 1024 * 1024),
          'x-goblin-access-token': 'secret',
        },
        body: 'x'.repeat(20 * 1024 * 1024),
      }),
    )
    expect(response.status).toBe(413)
  })

  test('/api/health/* enforces a tight (1 KiB) body cap', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      accessToken: 'secret',
      appRealtimeHost: appRealtimeHostStub,
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      worktreeRemovalApplication: worktreeRemovalApplicationStub,
    })
    // Two-kilobyte body to a hypothetical /api/health endpoint —
    // 1 KiB is plenty for the JSON requests health probes actually
    // send, so anything bigger should 413 (regardless of whether
    // the endpoint exists with that method).
    const response = await app.request(
      new Request('http://127.0.0.1:32100/api/health', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(2 * 1024),
        },
        body: 'x'.repeat(2 * 1024),
      }),
    )
    expect(response.status).toBe(413)
  })
})
