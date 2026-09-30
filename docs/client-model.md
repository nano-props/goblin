# Client Model

Use this doc for the server-first client model.

> A client is one loaded browser page. Client code lives in `src/web/`.

- Treat the backend as the primary runtime.
- Design client behavior around the server contract first.
- Prefer shared server-backed terminal, session, and realtime paths across browser clients.
- Keep client identity semantics aligned across browser clients:
  - `userId`: authenticated terminal user. The server partitions session visibility, lifecycle cleanup, and realtime fanout by this id.
  - `clientId`: logical client for one loaded browser page . It validates and routes requests, but it does not own sessions.
  - Describe reconnect, mirror, and takeover in user/client/attachment terms, not operating-system window terms. In the terminal wire protocol, the attachment/controller identity is represented by `clientId`; do not introduce a separate `attachmentId` for multiple independent views inside one client, because that product mode is intentionally out of scope.

## Repository read models

- TanStack Query is the only runtime cache for server-owned repository reads.
  Repository snapshot, worktree status, and pull requests have independent keys,
  pending states, and failure lifecycles; do not mirror them into Zustand.
- Accepted query data and the latest refresh outcome are different facts. A
  background error may mark accepted data stale and expose retry feedback, but
  it does not revoke that data from route or command planning. Runtime ids,
  target leases, and server admission remain the actual safety boundaries.
- A successful `RepoSnapshot` contains complete remote metadata. Every present
  branch worktree contains its path plus required `isPrimary` and `isLocked`
  facts. Missing required facts fail strict decoding instead of producing a
  partial successful snapshot.
- `BranchSnapshotInfo` is the PR-free presentation base. Compose optional status
  and PR enrichment only at the consumer boundary, and keep missing status
  unknown rather than building a general merged branch/worktree map.
- Client snapshots provide route and presentation facts. Server commands resolve
  current target authority from the server-owned target catalog; a client query
  result never authorizes a command.
- Create/remove worktree responses describe their committed effect; they do not
  carry a full repository snapshot. Repository snapshots have one client cache
  submission path: the snapshot query converges from server-published
  invalidation without a mutation read-back or client-side cache replacement.
