// Install the browser bootstrap and location globals used by tests.
//
// The Vitest worker setup (`vitest.setup.ts`) already installs
// `localStorage` / `sessionStorage` shims, a no-op `ResizeObserver`,
// and other browser-only primitives. It does not, and should not,
// install these host globals — those vary per test and carry
// bootstrap-shaped data (server URL and access token).
//
// Tests that previously hand-rolled `Object.defineProperty(window,
// '__GOBLIN_BOOTSTRAP__', { ... })` blocks should call
// `installHostBootstrap()` from `beforeEach` instead.

interface HostBootstrapOptions {
  initialServer?: { url: string; accessToken: string }
}

export function installHostBootstrap(options: HostBootstrapOptions = {}): void {
  const initialServer = options.initialServer ?? {
    url: 'http://127.0.0.1:32100/',
    accessToken: 'secret',
  }

  Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', {
    configurable: true,
    value: {
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
