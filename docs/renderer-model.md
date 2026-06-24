# Renderer Model

Use this doc for the server-first renderer model.

- Treat the backend as the primary runtime.
- Design renderer behavior around the server contract first.
- Treat Electron renderers as specialized browser clients, not a separate privileged app architecture.
- Prefer shared server-backed terminal, session, and realtime paths across web and Electron.
- Keep renderer identity semantics aligned across web and Electron:
  - `userId`: authenticated terminal user. The server partitions session visibility, lifecycle cleanup, and realtime fanout by this id.
  - `clientId`: logical renderer client for one browser tab or Electron renderer. It validates and routes requests, but it does not own sessions.
  - Describe reconnect, mirror, and takeover in user/client/attachment terms, not Electron window terms.
