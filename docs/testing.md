# Testing Strategy & Spec

Tests in this repo protect product behavior and architectural contracts. They
describe what a user or a system can observe — rendered state, accessible
labels, emitted intents, persisted state, server responses, lifecycle
transitions — not how the implementation is wired together. This document is
the canonical spec; `AGENTS.md` defers to it for testing conventions.

## 1. Goals & non-goals

- Tests describe observable behavior. When a test needs to know an
  implementation detail (a private module, an internal helper) it is almost
  always a code smell; refactor the surface, not the test.
- We use Vitest as the single runner. No Mocha, Jest, Bun-test, or custom
  runners.
- We do not enforce a coverage threshold. Coverage is a diagnostic tool, not
  a goal. The reviewer's job is to keep risk-coverage in balance, not to
  chase a number.

## 2. Runner & environment

Vitest runs across two projects declared in `vitest.config.ts`:

- `node` (default): everything under `src/{main,server,shared,system}` and
  the top-level `src/check-ls.test.ts`. No DOM is loaded.
- `jsdom`: every file under `src/web/**` and any test that needs
  `document`, `window`, or layout primitives.

Tests select an environment with the standard Vitest directive, e.g.
`// @vitest-environment jsdom` at the top of the file. Default `node` is
cheaper; only opt into `jsdom` when the test contract needs the DOM.

The Vitest worker setup runs once per worker before any test code:
`vitest.setup.ts` owns the global shims (see §9). Tests do not redefine
those shims.

## 3. Library first

Always reach for the library tool before writing one yourself:

| Need                                                | Use                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render a React tree, query by accessible name       | `@testing-library/react` (`render`, `screen`)                                                                                                                                                                                                                                                                                                                                                         |
| Wrap a render in React's act environment            | `@testing-library/react` (`act`) — handles `IS_REACT_ACT_ENVIRONMENT` for the duration of the wrapped callback. Do not import `act` from `react` directly; React's raw `act` does not configure the test environment. `renderInJsdom` (§5) does **not** keep the flag on; tests that drive fake timers after render should wrap their call in `await act(async () => renderInJsdom(...))` themselves. |
| Type, click, tab through, fire keyboard events      | `@testing-library/user-event` (`userEvent.setup()`)                                                                                                                                                                                                                                                                                                                                                   |
| Query a non-React DOM (portals, raw HTML)           | `@testing-library/dom` (`screen.getByRole`, etc.)                                                                                                                                                                                                                                                                                                                                                     |
| Mock a module export                                | `vi.mock('module', factory)` + `vi.hoisted`                                                                                                                                                                                                                                                                                                                                                           |
| Type-safe access to a mocked function's state       | `vi.mocked(fn)`                                                                                                                                                                                                                                                                                                                                                                                       |
| Spying on a method that does not belong to a module | `vi.spyOn(obj, 'method')`                                                                                                                                                                                                                                                                                                                                                                             |
| Capture listener callbacks as typed mocks           | `MockInstance<T>` from `vitest`                                                                                                                                                                                                                                                                                                                                                                       |
| Fake timers                                         | `vi.useFakeTimers(...)` via `useFakeTimers()` in §7                                                                                                                                                                                                                                                                                                                                                   |
| Async waits                                         | `vi.waitFor`, RTL `waitFor`, `vi.advanceTimersByTimeAsync`                                                                                                                                                                                                                                                                                                                                            |
| Single canonical `WebSocket` mock                   | `installWebSocketMock({ autoOpen })` in §5. Do **not** write `class MockWebSocket` inside a test or helper — it has lived in three different shapes already; the helper is the only one reviewers should see.                                                                                                                                                                                         |
| Drive IPC request/response over the socket          | `installGoblinTestBridge(handlers)` in §5 — wires the shared `MockWebSocket.send` to a JSON router; tests only supply `handlers`.                                                                                                                                                                                                                                                                     |

A hand-rolled helper is allowed only when none of the above fit. Put the
helper in `src/test-utils/` (cross-cutting) or `src/web/test-utils/`
(web-only) and add a one-line comment naming the gap it fills. Tests never
import a helper from inside another test file.

### Anti-patterns (forbidden)

- Hand-rolled `createRoot` + `container` + `act` rendering outside
  `src/test-utils/`.
- Importing `act` from `react` in tests. Use `act` from
  `@testing-library/react` so the act environment flag is scoped to the
  callback.
- Inline `class MockTerminal` / `class MockWebSocket` outside
  `src/web/test-utils/`.
- Redefining `window.localStorage` or `window.sessionStorage` in any test
  file.
- `vi.stubGlobal('fetch', …)` for routes already covered by
  `installGoblinTestBridge`.
- Direct DOM `dispatchEvent(new KeyboardEvent(...))` for user input —
  use `userEvent.keyboard(...)`.

## 4. Test files

- Co-locate: `Foo.test.ts(x)` lives next to `Foo.ts(x)` in the same
  directory. Tests for shared infrastructure (`src/test-utils/**`,
  `src/web/test-utils/**`) live in their own directory.
- One test file per behavior surface. When a single file passes ~1000
  lines it is time to split by behavior:
  `Foo.open.test.ts`, `Foo.lifecycle.test.ts`, `Foo.io.test.ts`. Group
  files under a `__tests__/` subdirectory if the source has many siblings
  and a flat layout would be noisy.
- File naming: source filename verbatim, with `.test.ts` or `.test.tsx`
  based on the React surface. There is no `.component.test.tsx` suffix;
  pick one and stick with it.
- `describe('Foo', () => …)` wraps every test in a file; nested describes
  are encouraged when the surface has sub-behaviors.

## 5. Harnesses

The shared harnesses live under two roots. Importing them pulls in the
side-effects (`vi.mock(...)`, `globalThis` shims) needed by web tests.

### `src/test-utils/render.tsx`

Exports:

- `renderInJsdom(element, options?)` — wraps `@testing-library/react`'s
  `render`. Does **not** set `IS_REACT_ACT_ENVIRONMENT`; tests that need an
  `act` boundary should wrap their call in `await act(async () => …)`
  themselves (see §9 for why). Returns the standard RTL result plus a
  `flushAnimationFrames()` helper for tests that drive
  `requestAnimationFrame` directly.
- `flushMicrotasks(ticks = 3)` — drain `ticks` microtask rounds. Prefer
  this over `for (let i = 0; i < 5; i++) await Promise.resolve()`.

Tests call `renderInJsdom(<Foo />)` and never see a `createRoot`. An
`afterEach(cleanup)` is registered at module load so the RTL result is
disposed automatically; tests do not need to call `cleanup` themselves.

`src/test-utils/index.ts` re-exports `useFakeTimers` and
`advanceTimersAndFlush` from `timers.ts` alongside the render helpers so
tests can `import { renderInJsdom, useFakeTimers, advanceTimersAndFlush }
from '#/test-utils/index.ts'`.

### `src/test-utils/timers.ts`

Exports:

- `useFakeTimers()` — calls
  `vi.useFakeTimers({ toFake: ['setTimeout','setInterval','requestAnimationFrame','cancelAnimationFrame','Date','performance'] })`
  inside an `afterEach(() => vi.useRealTimers())` scope. Returns the `vi`
  namespace for chaining.
- `advanceTimersAndFlush(ms)` — `await vi.advanceTimersByTimeAsync(ms)`
  plus a microtask drain. Use this any time a test step needs both fake
  time and pending promises.

### `src/web/test-utils/xterm-mock.ts`

`@xterm/xterm` and the `@xterm/addon-*` packages ship no official test
helper. The current terminal tests avoid the problem by _not instantiating
xterm at all_: `TerminalSessionView.test.tsx` and
`TerminalSessionProvider.test.tsx` render
`<TerminalSessionContext.Provider value={fakeContext}>` and feed a fake
`worktreeSnapshot`, so the real `@xterm/*` modules are never imported and
there is no `MockTerminal` to share.

If a future test needs to drive the real `Terminal` (e.g. paste-handling
edge cases that must reach into xterm's input pipeline), Vitest v4's
`vi.mock` factory closures can only see variables declared with
`vi.hoisted` **in the calling file**, so the mock classes must live in
the test file that registers the mocks. A new shared module will be
possible when Vitest lifts the per-file hoist restriction or when
upstream `@xterm/*` ships its own test helper.

### `src/web/test-utils/websocket-mock.ts`

- `installWebSocketMock({ autoOpen })` — installs a `MockWebSocket` on
  `globalThis.WebSocket` with two flavors. The default (`autoOpen: true`)
  mirrors the repo-store test's behavior (open fires on the next
  microtask). `autoOpen: false` is used by `terminal.test.ts` style tests
  that call `emitOpen()` themselves to control timing.
- `MockNotification` and `installNotificationMock()` — for browser
  notification clicks in web host mode.

### `src/web/test-utils/bridge.ts`

- `installGoblinTestBridge(handlers)` — installs `window.goblinNative`,
  the client bridge via `setClientBridgeForTests`, and a path-keyed
  `fetch` stub. `handlers` is `Record<string, (input) => unknown>` mapping
  IPC pathnames (e.g. `'repo.probe'`) and server routes (e.g.
  `'repo.snapshot'`) to their test handlers.
- `resetReposStore()`, `seedRepoState({...})`, `createBranchSnapshot(...)`,
  `createRepoBranch(...)`, `createPullRequest(...)` — moved here from
  `src/web/stores/repos/test-utils.ts` so non-repo tests can use them
  without dragging in the repo store. The old path keeps a one-line
  re-export for this PR and is marked `@deprecated`.

### `src/web/test-utils/host-bootstrap.ts`

- `installHostBootstrap()` — sets `window.__GOBLIN_BOOTSTRAP__`,
  `window.goblinNative`, `window.location`. Designed to replace the
  ~30-line `beforeEach` block in web-host tests that need a fake host
  environment.

## 6. Mocks policy

- Mocks at module boundaries, not at function boundaries.
  `vi.mock('module')` for cross-module dependencies; inline `vi.fn()` for
  collaborators passed through context (Zustand stores, React providers).
- Mock data must be privacy-safe: generic names, paths, branches, hashes,
  emails, tokens. Never reference real users, machines, or
  internal infrastructure.
- Do not re-implement server logic in mocks. If a mock starts composing
  the real server's behavior (e.g. `probe + resolveTarget →
RemoteRepoConnectionResult`), prefer injecting the real function with
  stubbed dependencies, or mark the test as a contract test that drives
  the real path through an in-memory transport. The composition
  duplicates the server and drifts silently.
- `vi.hoisted(() => ({ fn: vi.fn(), … }))` is the standard way to share
  mocks between the `vi.mock(...)` factory and the test body. Module
  scope variables do not work because the factory runs before module
  evaluation.

## 7. Timers

- Default to real timers. Most UI tests using RTL `waitFor` do not need
  fake timers.
- When fake timers are needed (animation frames, debounce, retry,
  countdown, reconnect), use `useFakeTimers()` from
  `src/test-utils/timers.ts`. The helper registers an `afterEach` to
  restore real timers so a stale fake clock cannot leak between tests.
- Inside a test, `await advanceTimersAndFlush(ms)` is preferred over
  bare `vi.advanceTimersByTimeAsync(ms)` when the step also needs
  microtasks to settle.
- Tests that need > 1s of fake time are a smell. The seam being tested
  should accept the time as a dependency, not depend on real durations.

## 8. Async & microtasks

- Use `await Promise.resolve()` or `await flushMicrotasks()` to drain
  microtasks. The bare `for (let i = 0; i < 5; i++) await Promise.resolve()`
  loop is forbidden — use `flushMicrotasks(5)` so the count is visible
  and reviewable.
- Use `await vi.waitFor(() => …)` (Vitest) or `await waitFor(() => …)`
  (RTL) for retries. Hard-coding `setTimeout(…, 50)` is forbidden.
- `expect(...).resolves` / `expect(...).rejects` are the standard way to
  await a single promise. Don't write `let err; try { ... } catch (e) { err = e }`.

## 9. Vitest setup (`vitest.setup.ts`)

The setup file owns these global shims because they cannot be expressed
as per-test mocks:

1. Filter Node v25's `--localstorage-file was provided without a valid
path` warning (process startup, before any test code runs).
2. Install an in-memory `Storage` shim on `globalThis.localStorage` and
   `globalThis.sessionStorage` so the Zustand persist middleware always
   finds a valid storage regardless of test environment ordering.
3. Stub `window.focus` as a no-op in jsdom (real notifications call it;
   jsdom's virtual console otherwise logs "not implemented").
4. Stub `HTMLCanvasElement.prototype.getContext` to return `null` in
   jsdom (xterm's `ImageAddon` would otherwise log "Not implemented").
5. Install a no-op `ResizeObserver` on `window` in jsdom (Radix UI's
   Tooltip and HoverCard mount one per `TooltipContent`; jsdom does not
   implement it).

Tests do not redefine these. If a test needs to bypass a shim (e.g. spy
on `canvas.getContext`), install the spy inside the test body so it runs
after the setup file.

React 18/19 act warnings: the earlier revision of this list included
a `console.error` patch that swallowed the "An update to `<Component>`
inside a test was not wrapped in act(...)" warnings. That patch is no
longer needed because the actual root cause was in
`src/test-utils/render.tsx`, not here. `renderInJsdom` used to set
`globalThis.IS_REACT_ACT_ENVIRONMENT = true` permanently, which left
the worker in the "act environment is on but no `act` is currently
running" state that React 19's `warnIfUpdatesNotWrappedWithActDEV`
flags on every post-mount commit. The global now stays at its default
`undefined` / `false` outside explicit `act` calls. Tests that
genuinely need an `act` boundary — typically those that drive fake
timers, await async updates, or assert on intermediate state — should
wrap their `renderInJsdom(...)` calls in
`await act(async () => renderInJsdom(...))` themselves, with `act`
imported from `@testing-library/react`. RTL's `act` (see
`node_modules/@testing-library/react/dist/act-compat.js:39-77`) sets
the flag only for the wrapped callback and restores it on the way out,
which is the contract we now follow.

## 10. Verification gates

Every PR must leave these green:

- `bun run typecheck`
- `bun run test`
- `bun run check` (which runs `check:architecture` and
  `check:no-html-injection`)

If a verification step is legitimately slow, the fix is to extract a
deterministic seam, not to raise the timeout. The default
`testTimeout: 10_000` is a ceiling for genuinely slow setup (real timers,
real IPC), not a target.

## 11. Current refactoring status (this branch)

The PR that introduced this spec made the following changes. Later
work should continue from here rather than re-litigating these
items:

- **Vitest project split** — `vitest.config.ts` now has two projects
  (`node` and `jsdom`) so DOM startup costs are not paid for server /
  shared / system tests.
- **Shared test helpers** — `src/test-utils/` holds `renderInJsdom`,
  `flushMicrotasks`, `useFakeTimers`, `advanceTimersAndFlush`, and
  `mockFetch`. `src/web/test-utils/` holds `installWebSocketMock`,
  `installHostBootstrap`, and `installGoblinTestBridge`. (There is no
  `xterm-mock.ts` — see §5 for why the terminal tests skip xterm
  entirely rather than mock it.)
- **Fetch mock consolidation** — tests that previously hand-rolled
  `const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)` now
  use `mockFetch(...)`.
- **WebSocket mock single source** — `bridge.ts` no longer contains an
  inline `MockWebSocket`; it wraps the shared `installWebSocketMock`.
- **Lifecycle mock backed by real server composition** —
  `src/web/stores/repos/repo-session-test-utils.ts` injects test doubles
  into the real `resolveServerRemoteRepoConnection` instead of
  duplicating its compose logic.

### Known follow-ups (out of scope for this PR)

1. **jsdom → `@testing-library/react` migration** — Done. The 58 web
   `.test.tsx`/`.test.ts` files that used hand-rolled `createRoot` +
   `container` + `act` boilerplate now go through `renderInJsdom`.
   Verified by `grep -rl 'createRoot(' src/web --include='*.test.{ts,tsx}'`
   returning no matches and the full `bun run test` run (259 files /
   2103 tests) staying green.
2. **React act warnings in jsdom** — Resolved by removing the
   `renderInJsdom` helper's permanent `IS_REACT_ACT_ENVIRONMENT = true`
   flip (see §5). React 19's `warnIfUpdatesNotWrappedWithActDEV` only
   fires when that global is set and no `act` is on the call stack —
   the previous `renderInJsdom` left the worker in exactly that
   state, producing one warning per post-mount commit. Returning to
   RTL's own pattern (the global is set only inside an `act` callback
   and restored on the way out) clears the warnings without any
   filter layer and without touching the hooks or Radix. Tests that
   genuinely need an `act` boundary now wrap their own
   `renderInJsdom(...)` calls.
3. **Extract `MockTerminal` / split `TerminalSession.test.ts`** —
   Resolved by _avoiding the mock in the first place_. The terminal
   tests (`TerminalSessionView.test.tsx`,
   `TerminalSessionProvider.test.tsx`) render
   `<TerminalSessionContext.Provider value={fakeContext}>` and feed a
   fake `worktreeSnapshot` rather than instantiating `@xterm/xterm` +
   seven addons, so there is no `MockTerminal` class to share and no
   `vi.hoisted` cross-file barrier to work around. If a future test
   needs to drive the real `Terminal` class (e.g. paste-handling edge
   cases inside xterm), re-open this item and lift the `vi.mock` /
   inline addon stubs into `src/web/test-utils/xterm-mock.ts` once
   Vitest v4 lifts the per-file `vi.hoisted` restriction or the project
   switches to a non-hoisted mock mechanism.

## 12. Adding a new test — checklist

1. Pick the directory next to the source file. Use `__tests__/` only if
   the directory is already crowded.
2. Pick the environment: default `node` unless DOM is part of the
   contract. If jsdom is needed, add `// @vitest-environment jsdom`.
3. Render React with `renderInJsdom(<Foo />)`. Drive input with
   `userEvent.setup()`. Query with `screen.getByRole` / `findByText`.
4. Mock modules at the boundary with `vi.mock('module', …)`. Use
   `vi.hoisted` for shared mock state. Use `vi.mocked(fn)` for typed
   access.
5. If the test needs fake timers, call `useFakeTimers()` once at the
   top of the file (or inside the relevant `describe` block).
6. Privacy-safe fixtures. No real user, machine, or token references.
7. Run `bun run typecheck && bun run test` before opening the PR.
