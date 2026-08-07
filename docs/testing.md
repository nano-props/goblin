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

- `node` (default): everything under `src/{main,server,shared,system}`. No
  DOM is loaded.
- `jsdom`: every file under `src/web/**`, the top-level
  `src/vitest-storage-shim.test.ts` canary, and any test that needs
  `document`, `window`, or layout primitives.

Tests select an environment with the standard Vitest directive, e.g.
`// @vitest-environment jsdom` at the top of the file. Default `node` is
cheaper; only opt into `jsdom` when the test contract needs the DOM.

The Vitest worker setup runs once per worker before any test code:
`vitest.setup.ts` owns the global shims (see §9). Tests do not redefine
those shims.

## 3. Library first

Always reach for the library tool before writing one yourself:

| Need                                                | Use                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render a React tree, query by accessible name       | `renderInJsdom` from `src/test-utils/render.tsx`, then `@testing-library/react` queries                                                                                                                                                                                                     |
| Render a React hook                                 | `renderHookInJsdom` from `src/test-utils/render.tsx`                                                                                                                                                                                                                                        |
| Flush React work scheduled by an async test step    | `@testing-library/react` (`act`) — handles `IS_REACT_ACT_ENVIRONMENT` for the duration of the callback. RTL already wraps the synchronous render; put timer advancement or the state-changing async operation inside `await act(async () => …)`. Do not import `act` from `react` directly. |
| Type, click, tab through, fire keyboard events      | `@testing-library/user-event` (`userEvent.setup()`)                                                                                                                                                                                                                                         |
| Query a non-React DOM (portals, raw HTML)           | `@testing-library/dom` (`screen.getByRole`, etc.)                                                                                                                                                                                                                                           |
| Mock a module export                                | `vi.mock('module', factory)` + `vi.hoisted`                                                                                                                                                                                                                                                 |
| Type-safe access to a mocked function's state       | `vi.mocked(fn)`                                                                                                                                                                                                                                                                             |
| Spying on a method that does not belong to a module | `vi.spyOn(obj, 'method')`                                                                                                                                                                                                                                                                   |
| Capture listener callbacks as typed mocks           | `MockInstance<T>` from `vitest`                                                                                                                                                                                                                                                             |
| Fake timers                                         | `vi.useFakeTimers(...)` via `useFakeTimers()` in §7                                                                                                                                                                                                                                         |
| Async waits                                         | `vi.waitFor`, RTL `waitFor`, `vi.advanceTimersByTimeAsync`                                                                                                                                                                                                                                  |
| Single canonical `WebSocket` mock                   | `installWebSocketMock({ autoOpen })` in §5. Do **not** define another `MockWebSocket` in a test or helper; one harness owns that boundary.                                                                                                                                                  |
| Drive IPC request/response over the socket          | `installGoblinTestBridge(handlers)` in §5 — wires the shared `MockWebSocket.send` to a JSON router; tests only supply `handlers`.                                                                                                                                                           |

A hand-rolled helper is allowed only when none of the above fit. Put the
helper in `src/test-utils/` (cross-cutting) or `src/web/test-utils/`
(web-only) and add a one-line comment naming the gap it fills. Tests never
import a helper from inside another test file.

### Guarded harness boundaries

- Hand-rolled `createRoot` + `container` + `act` rendering in test files.
  A shared harness may own a lower-level render boundary when RTL genuinely
  does not fit; document that gap at the helper.
- Importing `act` from `react` in tests. Use `act` from
  `@testing-library/react` so the act environment flag is scoped to the
  callback.
- Importing RTL `renderHook` directly in tests. Use `renderHookInJsdom` so the
  shared helper owns `afterEach(cleanup)` when Vitest globals are disabled.
- Defining or installing a WebSocket mock outside
  `src/web/test-utils/websocket-mock.ts`. An inline xterm mock is allowed only
  in `src/web/test-utils/terminal-session.ts`; do not duplicate that
  `vi.hoisted` boundary in component or provider tests.
- Redefining `window.localStorage` or `window.sessionStorage` in tests or
  ad-hoc helpers. `withBrowserStorageUnavailable()` in
  `src/test-utils/storage.ts` owns the narrow failure-path boundary that
  temporarily hides a setup-provided storage binding and restores it.
- Direct `vi.stubGlobal('fetch', …)` in tests. Use `installGoblinTestBridge`
  for client routes and `mockFetch()` from `src/test-utils/fetch-mock.ts` for
  a raw fetch boundary that the bridge does not model.

These are ownership boundaries rather than a complete test-style linter. For
user input, prefer `userEvent.keyboard(...)`; listener-contract tests that
must inspect repeat or default prevention can use `keyboardEventForTest(...)`
or construct the narrow event shape they genuinely need.

## 4. Test files

- Co-locate: `Foo.test.ts(x)` lives next to `Foo.ts(x)` in the same
  directory. Tests for shared infrastructure (`src/test-utils/**`,
  `src/web/test-utils/**`) live in their own directory.
- One test file per behavior surface. Around 1000 lines, evaluate whether a
  split by behavior would improve ownership and navigation:
  `Foo.open.test.ts`, `Foo.lifecycle.test.ts`, `Foo.io.test.ts`. Group
  files under a `__tests__/` subdirectory if the source has many siblings
  and a flat layout would be noisy. A 1500-line automated tripwire catches
  clearly oversized surfaces while leaving room for cohesive suites.
- Prefer the source filename with `.test.ts` or `.test.tsx`; avoid inventing
  additional suffix conventions unless they communicate real ownership.
- Use a named `describe` when it makes a multi-behavior file easier to scan.
  Focused top-level tests are valid Vitest and do not need a wrapper solely
  for formatting consistency.

## 5. Harnesses

The shared harnesses live under `src/test-utils`, `src/server/test-utils`,
and `src/web/test-utils`. Importing them pulls in the side-effects
(`vi.mock(...)`, `globalThis` shims) needed by their tests.
Shared test utilities use the same 1500-line oversized-surface tripwire as
test files so fixture extraction cannot merely hide severe size debt in a
harness. Treat roughly 1000 lines as a review signal, not a mandatory split.
Extract a harness to share a real boundary or encapsulate noisy, unsafe state,
not solely to shorten its only consumer. A single-consumer harness should make
the combined surface smaller or safer; prefer fail-fast actions over exported
nullable callbacks that can silently skip the behavior under test.
When a harness installs module mocks, import it before every production-graph
runtime import. If the test also consumes harness exports, use one leading
named import rather than a separate side-effect import of the same module.

### `src/test-utils/render.tsx`

Exports:

- `renderInJsdom(element, options?)` — wraps `@testing-library/react`'s
  `render`, including RTL's synchronous `act` boundary. It does not keep
  `IS_REACT_ACT_ENVIRONMENT` enabled afterward. Tests wrap the later
  state-changing async operation—not the render—in an explicit RTL `act`.
  Returns the standard RTL result plus a `flushAnimationFrames()` helper.
- `renderHookInJsdom(callback, options?)` — wraps RTL's `renderHook` while
  retaining this module's shared cleanup boundary.

Tests call these helpers instead of creating React roots directly. An
`afterEach(cleanup)` is registered at module load so the RTL result is
disposed automatically; tests do not need to call `cleanup` themselves.

Import each canonical helper module directly: `render.tsx`, `timers.ts`, or
`microtasks.ts`. Do not add an index re-export layer.

### `src/test-utils/microtasks.ts`

Exports `flushMicrotasks`, `waitForMicrotaskCondition`, and
`waitForNextMacrotask`. Use the narrowest helper matching the ordering
boundary under test; do not replace a condition with an arbitrary sleep.

### `src/test-utils/timers.ts`

Exports:

- `useFakeTimers()` — calls
  `vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame','Date','performance'] })`
  inside an `afterEach(() => vi.useRealTimers())` scope. Returns the `vi`
  namespace for chaining.
- `advanceTimersAndFlush(ms)` — `await vi.advanceTimersByTimeAsync(ms)`
  plus a microtask drain. Use this any time a test step needs both fake
  time and pending promises.

### `src/web/test-utils/terminal-session.ts`

`@xterm/xterm` and the `@xterm/addon-*` packages ship no official test
helper. Component and provider tests normally avoid instantiating xterm by
rendering `<TerminalSessionContext.Provider value={fakeContext}>`. The core
`TerminalSession.*.test.ts` suites import this harness first so its
`vi.hoisted` factories install before the production module graph loads, then
call `resetTerminalSessionHarness` in `beforeEach`. Keep the mock classes
private to that harness and expose only narrow observation or mutation
capabilities needed by the behavior suites.

### `src/web/test-utils/websocket-mock.ts`

- `installWebSocketMock({ autoOpen })` — installs a `MockWebSocket` on
  `globalThis.WebSocket` with two flavors. The default (`autoOpen: true`)
  opens on the next microtask. Use `autoOpen: false` when the contract under
  test requires explicit control over connection timing.
- The returned handle also exposes the installed `MockNotification`
  constructor and notification instances for browser-notification tests.

### `src/web/test-utils/bridge.ts`

- `installGoblinTestBridge(handlers)` — installs the bootstrap/native host
  boundary, shared WebSocket router, and a path-keyed `fetch` stub. It clears
  any explicit client-bridge override so tests exercise the runtime-selected
  transport. `handlers` is `Record<string, (input) => unknown>` mapping host
  actions, socket actions, and server routes to their test responses.

### `src/web/test-utils/repo-store.ts`

- Owns repo/store fixtures such as `resetWorkspacesStore()`,
  `createBranchSnapshot(...)`, `createRepoBranch(...)`, and
  `createPullRequest(...)`. Import it only when a test needs workspace store
  state; transport-only tests stay on `bridge.ts` without loading that graph.

### `src/web/test-utils/host-bootstrap.ts`

- `installHostBootstrap()` — sets `window.__GOBLIN_BOOTSTRAP__`,
  `window.goblinNative`, and `window.location` for tests that need a fake host
  environment.

## 6. Mocks policy

- Mocks at module boundaries, not at function boundaries.
  `vi.mock('module')` for cross-module dependencies; inline `vi.fn()` for
  collaborators passed through context (Zustand stores, React providers).
- Mock data must be privacy-safe: generic names, paths, branches, hashes,
  emails, tokens. Never reference real users, machines, or
  internal infrastructure.
- Do not re-implement server logic in mocks. If a mock starts composing
  the real server's behavior (e.g. `probe + resolveTarget -> RemoteWorkspaceConnectionResult`), prefer injecting the real function with
  stubbed dependencies, or mark the test as a contract test that drives
  the real path through an in-memory transport. The composition
  duplicates the server and drifts silently.
- `vi.hoisted(() => ({ fn: vi.fn(), … }))` is the standard way to share
  mocks between the `vi.mock(...)` factory and the test body. Module
  scope variables do not work because the factory runs before module
  evaluation.
- When `vi.importActual` or `importOriginal` needs a module namespace type,
  declare it with a top-level type-only namespace import and pass
  `typeof ModuleName` to the helper. Do not use `typeof import('…')`; the
  repository-wide inline-type-import check covers tests and test utilities.

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
- Prefer `await waitForNextMacrotask()` when ordering depends on crossing one
  real event-loop turn; the shared helper usually makes the boundary clearer.
  A local timer remains acceptable when the timer itself is the behavior
  under test.
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
6. Restore jsdom's real `Window` before every test so narrow host facades
   cannot leak browser lifecycle methods across tests.
7. Before jsdom environment teardown, cross one real host timer turn so
   zero-delay Radix FocusScope callbacks already queued by component cleanup
   cannot observe removed DOM globals. This is a temporary workaround for
   issue #374 and does not advance Vitest's fake clock.

Tests do not redefine these. If a test needs to bypass a shim (e.g. spy
on `canvas.getContext`), install the spy inside the test body so it runs
after the setup file.

The act environment flag remains disabled outside explicit `act` calls. Tests
that need an asynchronous act boundary—typically those that drive fake timers
or assert on intermediate state—wrap the state-changing operation itself with
`act` from `@testing-library/react`. RTL render already supplies its synchronous
act boundary. Do not suppress act warnings or enable the global act environment
for an entire worker.

## 10. Verification gates

Every PR must leave these green:

- `bun run test`
- `bun run check` (typecheck, architecture, HTML injection, type assertions, and format)

If a verification step is legitimately slow, the fix is to extract a
deterministic seam, not to raise the timeout. The default
`testTimeout: 10_000` is a ceiling for genuinely slow setup (real timers,
real IPC), not a target.

## 11. Keeping this spec current

This document records maintained rules, not migration history or snapshots
of suite size. Do not add file counts, test counts, timing claims, or
"migration complete" statements here; they become false as the suite grows.

`src/test-utils/test-harness-policy.test.ts` guards the repository-wide
harness invariants that are cheap to verify statically: React tests do not
hand-roll roots or mutate the global act flag, and web tests use the canonical
WebSocket mock. Behavioral conventions that require judgment remain review
rules rather than source-text checks.

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
7. Run `bun run test && bun run check` before opening the PR.
