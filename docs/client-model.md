# Client Model

Use this doc for the server-first client model.

> *We use "client" to mean a browser-side UI host — this includes both Electron client processes and plain web browser tabs. The legacy term "client" is retained in the code directory `src/web/` and in a few historical type names for compatibility.*

- Treat the backend as the primary runtime.
- Design client behavior around the server contract first.
- Treat Electron clients as specialized browser clients, not a separate privileged app architecture.
- Prefer shared server-backed terminal, session, and realtime paths across web and Electron.
- Keep client identity semantics aligned across web and Electron:
  - `userId`: authenticated terminal user. The server partitions session visibility, lifecycle cleanup, and realtime fanout by this id.
  - `clientId`: logical client for one browser tab or Electron client. It validates and routes requests, but it does not own sessions.
  - Describe reconnect, mirror, and takeover in user/client/attachment terms, not Electron window terms.
