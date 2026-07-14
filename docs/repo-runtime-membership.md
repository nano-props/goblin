# Repo Runtime Membership

Use this doc for repo open/close ownership.

## Decision

Repo runtime identity is server-owned. Repo workspace membership is
client-window-owned.

The server owns:

- the current `repoRuntimeId` for a `(userId, repoRoot)` runtime scope
- stale runtime rejection
- terminal/session cleanup when a repo runtime closes
- the remote lifecycle and monotonic attempt generation for that runtime
- the idempotent client-membership set that keeps the shared epoch alive
- presence-backed membership expiry after a client remains disconnected for
  the configured grace period

The client window owns:

- which repos are shown in that window
- repo switcher order
- active repo
- restored workspace membership from `WorkspaceSessionState`

## Why

Different windows may reasonably show different repositories or focus a
different active repository. Making repo membership globally server-owned
would make a close in one window implicitly close the repo in another window,
which is not the current product model.

The server still needs to own runtime identity because repo-scoped terminal
and mutation paths must fail fast when a client targets a stale runtime.

## Data Flow

Open:

1. The client asks the server to open or resolve a repo runtime.
2. The server returns a canonical `repoRuntimeId`.
3. The client inserts or updates its window-local repo projection with that
   runtime id.

Close:

1. The client removes the repo from its window-local projection.
2. The client releases its `clientId` membership for the matching `repoRuntimeId`.
3. Other client memberships keep the shared epoch current.
4. The last release stops the epoch; stale and repeated releases are no-ops.
5. Server-side repo-runtime close events clean up runtime-scoped terminal
   resources.

Restore:

1. `ClientWorkspaceState.openRepoEntries` is submitted once as boot restore
   intent for that window.
2. Restore reopens runtimes through the server before writing any
   repo projection.
3. The server returns canonical repo entries and runtime identities. The client
   persists the entries locally for its next launch.

Realtime recovery:

1. WebSocket heartbeat and socket counts are the only online-presence
   authority; repo runtime code does not poll or infer browser lifecycle.
2. When the last socket for a `clientId` disappears, the server captures the
   client's current membership generations and starts a grace timer.
3. An HTTP acquire made before the first realtime connection starts the same
   grace timer immediately. First online presence claims the membership and
   cancels this orphan-admission lease.
4. Reconnect cancels the timer. Expiry releases only the captured generations,
   so a later HTTP acquire cannot be removed by an old disconnect timer.
5. After reconnect, the window submits its complete current repo set through
   one batch reconcile command. The server replaces only that client's
   memberships and returns canonical runtime ids.
6. The client commits changed runtime ids atomically, resets transient
   epoch-owned state, and only then recovers remote lifecycle, terminals and
   workspace tabs with the new scopes.

## Rules

- Do not create a global server-persisted open-repo list. Membership is scoped
  by `clientId`; the next-launch declaration is window-local state.
- Do not let the client mint or validate `repoRuntimeId` locally.
- Server routes that mutate repo-scoped runtime resources should validate the
  server-owned `repoRuntimeId` when the operation targets runtime state.
- Client cache keys for runtime-scoped resources should include
  `repoRuntimeId` where stale runtime separation matters.
- Do not use `beforeunload`, periodic scans, or a second client-side presence
  model for correctness. Page lifecycle notification may be an optimization,
  never the ownership boundary.

## React Query Implication

React Query can own server data for a repo after the client window has opened
that repo, but React Query should not become a global open-repo membership
owner under the current product model.

Good candidates for React Query ownership:

- snapshot reads
- status reads
- pull request reads
- file tree reads
- workspace pane tabs reads
- the user-scoped runtime snapshot used to project remote lifecycle state

Remote lifecycle transitions publish a dedicated `remote-lifecycle`
invalidation. Clients refresh the lightweight runtime snapshot and accept only
entries matching a window-local repo shell and `repoRuntimeId`; the snapshot
never adds, removes, orders, or activates repos for a window. Command responses
and snapshot refreshes share one attempt-gated projector, so transport order
cannot make an older attempt overwrite a newer lifecycle.

Keep in window-local state:

- repo order
- active repo
- branch selection
- workspace layout
- restored membership
