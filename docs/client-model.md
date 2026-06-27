# Client Model

Use this doc for the server-first client model.

> _We use "client" to mean a browser-side UI host — this includes both BrowserWindow-hosted Electron pages and plain web browser tabs. The code directory remains `src/web/` because it contains browser-side UI code; the architecture term is still "client"._

- Treat the backend as the primary runtime.
- Design client behavior around the server contract first.
- Treat Electron clients as specialized browser clients, not a separate privileged app architecture.
- Prefer shared server-backed terminal, session, and realtime paths across web and Electron.
- Keep client identity semantics aligned across web and Electron:
  - `userId`: authenticated terminal user. The server partitions session visibility, lifecycle cleanup, and realtime fanout by this id.
  - `clientId`: logical client for one browser tab or Electron client. It validates and routes requests, but it does not own sessions.
  - Describe reconnect, mirror, and takeover in user/client/attachment terms, not Electron window terms. In the terminal wire protocol, the attachment/controller identity is represented by `clientId`; do not introduce a separate `attachmentId` for multiple independent views inside one client, because that product mode is intentionally out of scope.
