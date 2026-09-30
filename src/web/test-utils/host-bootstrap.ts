// Install the browser bootstrap and location globals used by tests.
//
// The Vitest worker setup (`vitest.setup.ts`) already installs
// `localStorage` / `sessionStorage` shims, a no-op `ResizeObserver`,
// and other browser-only primitives. It does not, and should not,
// install these host globals — those vary per test and carry
// bootstrap-shaped data (server URL, access token, runtime kind).
//
// Tests that previously hand-rolled `Object.defineProperty(window,
// '__GOBLIN_BOOTSTRAP__', { ... })` blocks should call
// `installHostBootstrap()` from `beforeEach` instead.

import { CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'

interface HostBootstrapOptions {
  runtime?: 'web'
  initialServer?: { url: string; accessToken: string }
  bridgeVersion?: number
}

export function installHostBootstrap(options: HostBootstrapOptions = {}): void {
  const runtime = options.runtime ?? 'web'
  const initialServer = options.initialServer ?? {
    url: 'http://127.0.0.1:32100/',
    accessToken: 'secret',
  }
  const bridgeVersion = options.bridgeVersion ?? CLIENT_BRIDGE_VERSION

  Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', {
    configurable: true,
    value: {
      runtime: { kind: runtime, bridgeVersion, capabilities: [] },
      initialServer,
    },
  })

  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: initialServer.url,
      origin: new URL(initialServer.url).origin,
      search: '',
    },
  })
}
