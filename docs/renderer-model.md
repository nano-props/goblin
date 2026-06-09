# Renderer Model

Use this doc for the server-first renderer model.

- Treat the backend as the primary runtime.
- Design renderer behavior around the server contract first.
- Treat Electron renderers as specialized browser clients, not a separate privileged app architecture.
- Prefer shared server-backed terminal, session, and realtime paths across web and Electron.
- Keep renderer identity semantics aligned across web and Electron:
  - `clientId`: logical renderer client / session owner.
  - `attachmentId`: specific renderer attachment under that client.
  - Describe reconnect, mirror, and takeover in client/attachment terms, not Electron window terms.
