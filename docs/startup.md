# Startup Architecture

Startup separates public shell hydration, authentication, workspace restore,
and post-restore application behavior in browser tabs.

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

### Browser document lifecycle

`goblin serve` starts the server independently of the browser. Running `goblin`
without a command displays help. `goblin open [directory]` only opens a
browser-addressable `/open?path=<encoded-directory>` URL; it does not authenticate
or call the server. The bounded `path` is an absolute directory on the server,
with relative CLI arguments resolved against the CLI working directory.

The `/open` page mounts only after browser authentication and workspace restore.
It automatically opens the requested directory through the existing workspace
membership flow, then replaces the command URL with the normal workspace URL.
Login preserves the pending URL. Invalid paths and open failures remain on the
page for deliberate recovery. Navigation failure preserves successful membership
and retries only navigation. Leaving the page prevents a late completion from
redirecting the user; opening is not rolled back.

Closing a tab detaches its client; it does not stop the server or retire server-owned terminal sessions.
Client workspace presentation is persisted continuously in localStorage after
restore succeeds. Page lifecycle events offer only a best-effort final flush;
authoritative server state never depends on an unloading document.

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
  browser localStorage.
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
