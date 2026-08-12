# Startup Architecture

Startup separates public shell hydration, authentication, workspace restore,
and post-restore application behavior. Electron pages and browser tabs follow
the same functional stages.

## Stages

1. **Public bootstrap** hydrates unauthenticated-safe presentation state. It
   never reads or writes workspace session state.
2. **Authentication gate** validates or exchanges credentials, removes URL
   credentials before navigation or further network activity, and supports
   bounded cancellation.
3. **Authenticated restore** owns one restore attempt, including its timeout,
   cancellation, failure, and explicit retry. Only a completed attempt may
   declare the authenticated shell ready.
4. **Workspace membership restore** converges server-owned durable membership
   into live runtime leases. The server validates identities and returns
   addressable runtime shells even when repository enrichment is unavailable.
5. **Lazy workspace projection** loads authoritative repository and pane data
   when navigation needs it. Availability failure preserves membership and
   remains retryable; client placeholders never authorize server commands.
6. **Workspace side effects** start only after authenticated restore is ready
   and consume the routed workspace as navigation authority.

Each stage has one owner, one completion boundary, and one cancellation story.
Cancellation never commits success or opens persistence.

## Readiness

Keep these readiness concepts distinct:

- **Membership ready**: durable workspace membership has converged into live
  runtime shells. Repository content may still be loading.
- **Persistence open**: server restore and client-local hydration both
  completed, so later client state may be persisted safely.
- **Restore failed**: the shell can render recovery UI, but persistence remains
  closed until an explicit retry succeeds.

Consumers use a canonical readiness projection instead of recombining internal
flags. Optional authenticated enrichment may fail without blocking readiness;
membership and persistence failures may not.

### Native document delivery

Electron client-surface identity and renderer delivery readiness are separate
facts. The native host registers a window early enough to authenticate renderer
IPC, but sends a discrete client effect only after the exact application
document generation's preload has installed its lifetime intent listener and
acknowledged readiness to the native host. An action that creates the primary
window may wait within a bounded lifetime for that exact new document's preload
acknowledgement after the shared window creation has completed; the deadline
does not cancel or replace Electron's singleton window-loading lifecycle. An
existing document that is not ready fails fast. Reload, navigation replacement,
renderer exit, window close, load failure, or readiness timeout rejects delivery
instead of forwarding the effect to a later document. The preload handoff then
bridges that listener to the single client intent consumer
within the same document generation.

Native quit delivery is an application lifecycle signal, not an authenticated
UI command. Its consumer exists for the full web entrypoint lifetime, including
public bootstrap, authentication gates, route changes, and render fallbacks;
ordinary client effects remain owned by the authenticated UI router. Client
workspace presentation is already persisted continuously to browser storage or
the Electron user-data file. Quit delivery is only a bounded, best-effort chance
to flush its final debounce window; authoritative server state and native exit
do not depend on a loading or unavailable renderer.

## Routing

- Derive the requested workspace from the URL before client-store hydration.
- While membership is restoring, a requested workspace that is not yet in the
  client projection renders a restore state rather than not-found.
- After membership is ready, a missing requested workspace is not-found.
- Lazy projection validates the server-issued runtime identity and durable
  membership before returning workspace data.
- Route effects may project an externally arrived URL into client preferences;
  command correctness never depends on a later route effect.

## Persistence

- The server persists workspace membership and restart-durable static pane
  layout. Live runtime sessions remain projection-only.
- The client persists only client-owned presentation and navigation state in
  the storage appropriate to its host.
- Client and server state never become one combined session payload or a
  client-to-server whole-state write.
- Client persistence stays closed until restore and local hydration complete.
- High-frequency client writes may be debounced, with a final client-local
  flush at page lifecycle boundaries.

## Adding startup work

- Put public, unauthenticated work in public bootstrap.
- Authenticated non-blocking work may run alongside restore but cannot decide
  membership readiness.
- Boot membership work belongs to restore; live membership changes use explicit
  open and close commands.
- Work required to interpret restored state completes before persistence opens.
- Work that merely consumes hydrated workspace data belongs after readiness.
- Every asynchronous task defines cancellation, timeout, failure, and retry
  semantics without committing state after its owner is gone.

Workspace-pane repair and concurrency details are governed by
`workspace-pane-command-invariants.md`, not by the startup lifecycle.
