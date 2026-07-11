# Layering

Use this doc for feature layering rules.

## Goal

- Organize code by feature first.
- Split by concern only when needed.
- Keep control and read/write direction clear.

## Two axes

### Vertical: module / feature

- Treat each business area as a feature slice.
- Prefer feature-local files over broad cross-app buckets.
- A feature may span `src/server/`, `src/web/`, and `src/shared/`, but it should still read as one feature.

Examples:

- settings
- repos
- terminal
- remote
- realtime

### Horizontal: concern layers inside a feature

Use only the layers the feature needs.

#### 1. Boundary layer

- Handles protocol and transport boundaries.
- Parses input, calls the next layer, returns output.
- Should stay thin.

Typical files:

- `src/server/routes/*`
- `src/web/*-client.ts` (feature-scoped, not global buckets)

#### 2. Read layer

- Exposes read models, snapshots, and query hooks.
- Should stay read-only.
- May define query keys, query options, and refetch behavior.

Typical files:

- `src/web/*-queries.ts`
- `src/web/*-snapshot.ts`
- `src/server/modules/*-read.ts` (server-side read projection when needed)
- read-side selectors or projection readers

#### 3. Write layer

- Owns mutation orchestration.
- Runs writes, follow-up refresh, invalidation, and local projection/cache updates.
- This is the main place for write flow.
- Server-side write paths own invalidation publishing.
- Web-side write paths own query cache updates after server response. Settings writes are centralized in `src/web/settings-actions.ts`; raw `settings-client.ts` writes are transport-level and should not be called from components.

Typical files:

- `src/server/modules/*-write-paths.ts`
- `src/web/*-write-paths.ts`
- focused mutation orchestration modules

#### 4. Source layer

- Talks to persistence, durable storage, or other authoritative systems.
- Returns authoritative state after read/write operations.
- Do not add this layer unless storage or authoritative source rules are distinct.
- Keep domain policy (validation, business rules) out of this layer when it grows. Extract a policy/model helper or let the write layer own it.

Typical files:

- `src/server/modules/*-source.ts`
- storage adapters

#### 5. Runtime facade layer

- **Optional. Strictly scoped.**
- Exists only when a component needs a **stable, combined read + write API** for a feature.
- Must expose **both** read model projection and UI-safe actions.
- If a file only exposes read, it belongs in the read layer.
- If a file only exposes write, it belongs in the write layer or a local hook.
- Do not use it as a catch-all for feature logic, thin action wrappers, or generic error handling.

Typical files:

- `src/web/runtime-*.ts` (only when read + write are both present)

## Default flow

The default flow should look like this:

- read: boundary -> read layer -> UI
- write: UI -> boundary/client -> write layer -> source layer -> invalidation/cache/projection update -> UI

Do not mix read and write concerns unless the feature is still trivial.

## Server-side layering

Server-side features follow the same layering logic as the client side. Do not let route files accumulate business orchestration just because they are on the server.

| Layer    | Server responsibility                                    | Typical files                                                         |
| -------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| Boundary | Parse HTTP input, call next layer, return JSON           | `src/server/routes/*.ts`                                              |
| Read     | Query authoritative state, return snapshots              | `src/server/modules/*-read.ts` or direct source call for simple cases |
| Write    | Orchestrate mutations, publish invalidation, call source | `src/server/modules/*-write-paths.ts`                                 |
| Source   | Persistence, external system calls, file I/O             | `src/server/modules/*-source.ts`                                      |

Rules:

- A route file should not exceed input validation + delegating to the next layer.
- If a feature has complex mutations, extract `src/server/modules/<feature>-write-paths.ts`.
- If a feature has multiple read paths shared by routes or other modules, extract `src/server/modules/<feature>-read.ts`.
- Server-side read and write layers are **not** optional for features that already have them on the web side. Keep the server side symmetric.

## When not to split

Do not add layers just because the pattern exists.

Keep a feature in one file or one small cluster when most of these are true:

- the feature has one simple read path and one simple write path
- there is no cache coordination beyond a direct state update or refetch
- the UI only has one caller
- persistence details are not yet distinct from the write flow
- the file is still easy to explain and review as one unit

Small features should stay small.

## When to split

Split a feature into more layers when one of these becomes true:

- reads are shared by multiple callers or need their own query lifecycle
- writes need invalidation, follow-up refresh, optimistic/local projection updates, or native projection
- persistence or authoritative storage rules have become distinct from write orchestration
- UI components are starting to repeat the same mutation flow
- route or client code is accumulating business decisions

Use splitting to reduce confusion, not to satisfy a template.

## State-aware rule

When naming types, modules, or slices, keep these state classes visible when they matter:

- local
- runtime-coherent
- restorable

Use those distinctions to decide control first, then choose the layer.

## Naming rule

- Name modules by feature first, then by layer role.
- Prefer names that reveal responsibility in the flow.
- Use the narrowest stable name that matches the file's job.
- Do not create generic `controller`, `service`, or `manager` files that mix multiple concerns.

Prefer:

- `routes/settings.ts`
- `settings-queries.ts`
- `settings-write-paths.ts`
- `settings-source.ts`
- `runtime-settings-external-apps.ts` (only if it exposes read + write)

Avoid broad catch-all names like:

- `settings-service.ts`
- `settings-controller.ts`
- `repo-manager.ts`

Use `service` or `controller` only when that term is the real stable boundary and will not mix multiple concerns.

## Practical rules

- Start by creating a feature file or feature folder, not a global `services/` bucket.
- Add a separate read layer only when reads become shared or stateful enough to justify it.
- Add a separate write layer once mutations need orchestration, invalidation, or cache updates.
- Add a source layer only when persistence or authoritative storage logic becomes distinct.
- Add a runtime facade **only** when the UI benefits from a stable feature-facing API that combines reads and writes.
- Skip layers you do not need.

## Current repo examples

Use the current codebase as a guide, not as a rigid template.

### Settings

- boundary: `src/server/routes/settings.ts`, `src/web/settings-client.ts`
- read: `src/web/settings-queries.ts`
- write: `src/server/modules/settings-write-paths.ts`, `src/web/settings-actions.ts`
- source: `src/server/modules/settings-source.ts`
- runtime facade: `src/web/runtime-settings-*.ts` (only files that combine read + write)

This is a good example of a feature that has grown enough to justify explicit read and write layers.
It also shows a feature where a separate source layer makes sense.

### Repos

- boundary: `src/server/routes/repo.ts`, `src/web/repo-client.ts`
- read: `src/web/stores/repos/refresh.ts` (read-side refresh orchestration)
- write: `src/web/stores/repos/repo-session-write-paths.ts`, `src/web/stores/repos/branch-actions.ts`
- server write: `src/server/modules/repo-write-paths.ts` (to be extracted from `repo.ts`)
- source: `src/server/modules/repo-source.ts`
- runtime projection/facade: `src/web/stores/repos/store.ts`, related repo store slices
- restorable/runtime distinction: repo store types and lifecycle modules

This is a good example of a feature that should stay feature-first, even when its runtime projection is store-heavy instead of query-heavy.
It also shows that not every complex feature needs a separate runtime facade layer.

### Terminal

- boundary: `src/server/routes/realtime.ts`, `src/web/app-realtime.ts`, `src/web/terminal.ts`
- read: `src/web/runtime/AppRuntimeProjectionProvider.tsx` (server recovery orchestration), `src/web/components/terminal/TerminalSessionProjection.ts` (read projection)
- write: `src/server/terminal/terminal-runtime.ts` (factory; the authoritative source for session/session service/broker/dispatch), `src/web/components/terminal/TerminalSessionProjection.ts` (client-side write paths for `attach`/`select`/`create`)
- source: `src/server/terminal/terminal-session-manager.ts` (in-process state for sessions, target metadata, control, render), `src/server/terminal/terminal-session-service.ts` (public session-service facade), `src/server/terminal/pty-supervisor.ts` (PtySupervisor interface), `src/server/terminal/pty-supervisor-inprocess.ts` + `pty-supervisor-worker.ts` (PTY pool impls)
- protocol types: `src/shared/terminal-types.ts`, `src/shared/terminal-socket.ts`, `src/shared/terminal-validators.ts`, `src/shared/terminal-controller.ts`, `src/shared/terminal-worktree-key.ts` (client↔server wire types, validation, controller helpers, and repo/worktree grouping), `src/server/terminal/terminal-session-ids.ts` (server-side terminalSessionId allocation), `src/server/terminal/pty-worker-protocol.ts` (main↔PTY-worker wire types)

The server-side terminal runtime is created by `createServerTerminalRuntime({ ptySupervisor })` and contributes terminal handlers to the shared app realtime host. The realtime route receives that app realtime host via dependency injection from the server factory. The TerminalSessionProvider on the client side keeps `TerminalSessionProjection` as the single source of truth for live session state and uses the terminal client only for fetches and mutations.

Workspace-pane layout intent is server-owned, while live membership belongs to runtime providers. `src/server/workspace-pane/*` purely projects the two, materializing live entries and filtering stale order hints only in the returned canonical view. Reads do not write derived membership. Terminal contributes one runtime provider; the client renders this projection rather than inventing fallback rules from local terminal views.

**PtySupervisor exit metadata — deliberate asymmetry.** The in-process supervisor (`pty-supervisor-inprocess.ts`) reports `pty-exit` to listeners as `(code, signal) = (null, null)` because `node-pty`'s `onExit` only signals "exited" without those values, and by the time the callback fires the underlying term is already gone. The worker-backed supervisor delivers the real values carried by the IPC `pty-exit` event. The session manager does not currently branch on `code`/`signal` — `pty === null` is the canonical "session ended" signal — so the asymmetry is invisible at higher layers. A future need for `code`/`signal` (e.g. for status-bar UI) would require a more invasive change: the in-process supervisor would have to register an `onExit` listener at spawn time and persist the metadata, similar to how it currently caches the process name.

### Smaller UI interactions

- keep the logic local when it is only component interaction state
- only extract a runtime facade or write layer when the interaction starts to coordinate shared reads or writes

Examples include dialog-local input state and short-lived pending/error state.
These usually do not need a source layer or a runtime facade layer.

## Smells

Refactor when one of these happens:

- one file owns both complex reads and complex writes
- route files start containing business orchestration
- query files start patching mutation results directly in many places
- UI components start owning feature mutation flow
- a vague `service` or `controller` file becomes the catch-all for the feature
- server route or module files mix read, write, and source concerns
- a runtime facade file exposes only read or only write

## Rule of thumb

If you can explain a feature as:

- "this is the boundary"
- "this is the read side"
- "this is the write side"
- "this is the source"

then the layering is probably clear enough.
