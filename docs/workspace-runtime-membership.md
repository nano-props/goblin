# Workspace Runtime Membership

Use this doc for workspace open/close ownership.

## Decision

Workspace runtime identity and durable workspace membership are server-owned.
Runtime leases and workspace projections remain client-scoped.

The server owns:

- the current `workspaceRuntimeId` for a `(userId, workspaceId)` runtime scope
- stale runtime rejection
- terminal/session cleanup when a workspace runtime closes
- the remote lifecycle and monotonic attempt generation for that runtime
- the idempotent client-membership set that keeps the shared epoch alive
- presence-backed membership expiry after a client remains disconnected for
  the configured grace period

The server workspace owns:

- the shared open-workspace set and picker order persisted in
  `ServerWorkspaceState.openWorkspaceEntries`

The client window owns:

- active workspace
- its projection of the shared workspace
- the `clientId` runtime leases that keep workspace epochs alive

## Why

Open-workspace membership is a user-level workspace declaration, so it survives
relaunch and is shared across client surfaces. Active navigation remains local:
two windows may focus different workspaces without synchronizing routes.

This durable membership is distinct from runtime lease membership. Runtime
leases are scoped by `clientId`; they keep a shared epoch alive and let
workspace-scoped terminal paths and Git mutation adapters fail fast on stale runtime identities.

## Data Flow

Open:

1. The client asks the server to open or resolve a workspace runtime.
2. The server returns a canonical `workspaceRuntimeId`.
3. The explicit open command commits the workspace to the shared durable workspace.
4. The client inserts or updates its window-local projection only after the
   required server commits succeed.

Close:

1. The explicit close command removes the workspace from the shared durable workspace.
2. That durable commit invalidates every user runtime epoch projected from the
   removed global workspace entry, regardless of transient client or resource owners.
3. Server-side workspace-runtime close events clean up runtime-scoped terminal
   resources and notify every connected client to re-project the removal.
4. Each client removes the workspace from its local projection; later stale
   lease releases are no-ops.

Restore:

1. `ServerWorkspaceState.openWorkspaceEntries` is read as the shared boot restore
   intent.
2. Restore performs slow workspace probing and optional Git projection I/O outside the settings mutation queue, then
   compares membership through a short server-side CAS.
3. Concurrent membership changes are converged by retaining unchanged leases,
   releasing removed entries, and opening newly added entries.
4. The server returns canonical workspace entries and runtime identities. Membership
   remains server-owned; the client persists only its local selection and presentation.

Live commands:

1. Each client serializes open and close commands per workspace.
2. A local workspace becomes visible only after its runtime and durable workspace
   membership are both accepted.
3. A remote workspace commits membership before lifecycle probing, so an unavailable
   remote remains a shared, retryable workspace entry.
4. Lifecycle completion never writes membership; only explicit open and close
   commands may change the shared workspace set.

Realtime recovery:

1. WebSocket heartbeat and socket counts are the only online-presence
   authority; workspace runtime code does not poll or infer browser lifecycle.
2. When the last socket for a `clientId` disappears, the server captures the
   client's current membership generations and starts a grace timer.
3. An HTTP acquire made before the first realtime connection starts the same
   grace timer immediately. First online presence claims the membership and
   cancels this orphan-admission lease.
4. Reconnect cancels the timer. Expiry releases only the captured generations,
   so a later HTTP acquire cannot be removed by an old disconnect timer.
5. After reconnect, the window submits its complete current workspace set through
   one batch reconcile command. The server replaces only that client's
   memberships and returns canonical runtime ids.
6. The client commits changed runtime ids atomically, resets transient
   epoch-owned state, and only then recovers remote lifecycle, terminals and
   workspace tabs with the new scopes.

## Rules

- Keep durable workspace membership and runtime lease membership separate.
  `ServerWorkspaceState.openWorkspaceEntries` is user-level restore state;
  runtime leases are scoped by `clientId`.
- Only explicit open and close commands may mutate durable workspace membership.
- Restore and lazy promotion may compare durable membership, but never recreate
  a client-provided membership declaration.
- Closing a workspace runtime clears provider sessions and the matching pane epoch
  overlay/index/clock only. It never deletes durable pane layout; a new epoch
  immediately projects the durable pane layout without restore-time copying.
- Do not let the client mint or validate `workspaceRuntimeId` locally.
- Server routes that mutate repo-scoped runtime resources should validate the
  server-owned `workspaceRuntimeId` when the operation targets runtime state.
- Client cache keys for runtime-scoped resources should include
  `workspaceRuntimeId` where stale runtime separation matters.
- Do not use `beforeunload`, periodic scans, or a second client-side presence
  model for correctness. Page lifecycle notification may be an optimization,
  never the ownership boundary.

## React Query Implication

React Query can own server data for a workspace after the client window has projected
that workspace, but it must not become an independent workspace-membership authority.

Good candidates for React Query ownership:

- snapshot reads
- status reads
- pull request reads
- file tree reads
- workspace pane tabs reads
- the user-scoped runtime snapshot used to project remote lifecycle state

Remote lifecycle transitions publish a dedicated `workspace-runtime-invalidated`
invalidation. Clients refresh the lightweight runtime snapshot and accept only
entries matching a window-local workspace shell and `workspaceRuntimeId`; the snapshot
never adds, removes, orders, or activates workspaces for a window. Command responses
and snapshot refreshes share one attempt-gated projector, so transport order
cannot make an older attempt overwrite a newer lifecycle.

Keep in window-local state:

- workspace order
- active workspace
- branch selection
- workspace layout
- restored membership
