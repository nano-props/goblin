# Client Model

Use this doc for the server-first client model.

> _We use "client" to mean a browser-side UI host — this includes both BrowserWindow-hosted Electron pages and plain web browser tabs. The code directory remains `src/web/` because it contains browser-side UI code; the architecture term is still "client"._

- Treat the backend as the primary runtime.
- Design client behavior around the server contract first.
- Treat Electron clients as specialized browser clients, not a separate privileged app architecture.
- Prefer shared server-backed terminal, session, and realtime paths across web and Electron.
- Keep client identity semantics aligned across web and Electron:
  - `userId`: authenticated terminal user. The server partitions session visibility, lifecycle cleanup, and realtime fanout by this id.
  - `clientId`: logical client for one loaded browser page or Electron renderer instance. It validates and routes requests, but it does not own sessions.
  - Describe reconnect, mirror, and takeover in user/client/attachment terms, not Electron window terms. In the terminal wire protocol, the attachment/controller identity is represented by `clientId`; do not introduce a separate `attachmentId` for multiple independent views inside one client, because that product mode is intentionally out of scope.

## Repository read models

- React Query is the only runtime cache for server-owned repository reads.
  Repository snapshot, worktree status, and pull requests have independent keys,
  pending states, and failure lifecycles; do not mirror them into Zustand.
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
