# Repo Runtime Membership

Use this doc for repo open/close ownership.

## Decision

Repo runtime identity and durable workspace membership are server-owned.
Runtime leases and workspace projections remain client-scoped.

The server owns:

- the current `repoRuntimeId` for a `(userId, repoRoot)` runtime scope
- stale runtime rejection
- terminal/session cleanup when a repo runtime closes
- the remote lifecycle and monotonic attempt generation for that runtime
- the idempotent client-membership set that keeps the shared epoch alive
- presence-backed membership expiry after a client remains disconnected for
  the configured grace period

The server workspace owns:

- the shared open-repo set and picker order persisted in
  `ServerWorkspaceState.openRepoEntries`

The client window owns:

- active repo
- its projection of the shared workspace
- the `clientId` runtime leases that keep repo epochs alive

## Why

Open-repo membership is a user-level workspace declaration, so it survives
relaunch and is shared across client surfaces. Active navigation remains local:
two windows may focus different repos without synchronizing routes.

This durable membership is distinct from runtime lease membership. Runtime
leases are scoped by `clientId`; they keep a shared epoch alive and let
repo-scoped terminal and mutation paths fail fast on stale runtime identities.

## Data Flow

Open:

1. The client asks the server to open or resolve a repo runtime.
2. The server returns a canonical `repoRuntimeId`.
3. The explicit open command commits the repo to the shared durable workspace.
4. The client inserts or updates its window-local projection only after the
   required server commits succeed.

Close:

1. The explicit close command removes the repo from the shared durable workspace.
2. The client removes the repo from its local projection and releases its
   `clientId` lease for the matching `repoRuntimeId`.
3. Other client leases keep the shared epoch current until they converge or expire.
4. The last release stops the epoch; stale and repeated releases are no-ops.
5. Server-side repo-runtime close events clean up runtime-scoped terminal
   resources.

Restore:

1. `ServerWorkspaceState.openRepoEntries` is read as the shared boot restore
   intent.
2. Restore performs slow repo I/O outside the settings mutation queue, then
   compares membership through a short server-side CAS.
3. Concurrent membership changes are converged by retaining unchanged leases,
   releasing removed entries, and opening newly added entries.
4. The server returns canonical repo entries and runtime identities. Membership
   remains server-owned; the client persists only its local selection and presentation.

Live commands:

1. Each client serializes open and close commands per repo.
2. A local repo becomes visible only after its runtime and durable workspace
   membership are both accepted.
3. A remote repo commits membership before lifecycle probing, so an unavailable
   remote remains a shared, retryable workspace entry.
4. Lifecycle completion never writes membership; only explicit open and close
   commands may change the shared repo set.

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

- Keep durable workspace membership and runtime lease membership separate.
  `ServerWorkspaceState.openRepoEntries` is user-level restore state;
  runtime leases are scoped by `clientId`.
- Only explicit open and close commands may mutate durable workspace membership.
- Restore and lazy promotion may compare durable membership, but never recreate
  a client-provided membership declaration.
- Closing a repo runtime clears provider sessions and the matching pane epoch
  overlay/index/clock only. It never deletes durable pane layout; a new epoch
  immediately projects the repository layout without restore-time copying.
- Do not let the client mint or validate `repoRuntimeId` locally.
- Server routes that mutate repo-scoped runtime resources should validate the
  server-owned `repoRuntimeId` when the operation targets runtime state.
- Client cache keys for runtime-scoped resources should include
  `repoRuntimeId` where stale runtime separation matters.
- Do not use `beforeunload`, periodic scans, or a second client-side presence
  model for correctness. Page lifecycle notification may be an optimization,
  never the ownership boundary.

## React Query Implication

React Query can own server data for a repo after the client window has projected
that repo, but it must not become an independent workspace-membership authority.

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
