# Realtime

Use this doc for realtime transport and lifecycle rules.

- Prefer WebSocket invalidation plus targeted refetch for cross-window data.
- Use streaming only for UX-critical continuous flows such as terminal output.
- Document whether a new realtime path is invalidation or streaming.
- Explain why polling or refetch is not enough when adding a new realtime path.
- Prefer fixes in the shared server-backed bridge or protocol layer.
- Add Electron-specific realtime behavior only when the browser path cannot support the requirement.

## Channel categories

The above rules cover data-plane channels (`/ws/invalidation`, `/ws/terminal`) — they push server-owned state changes to subscribers. A third category exists for **control-plane relays**: a channel that forwards an action envelope triggered by an out-of-band write (e.g. `g ss` from a PTY arriving at `/ws/renderer-intent`). A relay is not invalidation (no refetch implied) and not streaming (one-shot per request, not continuous).

When adding a new `/ws/*` channel, classify it into one of these three before writing code:

- **Data plane — invalidation**: server state changed, subscriber should refetch.
- **Data plane — streaming**: server is producing a continuous event stream (PTY output, etc.).
- **Control plane — relay**: subscriber should apply an out-of-band action (open a tab, focus a view, run a command). One envelope per trigger; the server doesn't read from these sockets.

When the trigger for an action lives outside the renderer (CLI, OS shell, external integration), use the relay pattern rather than Electron IPC. The server broker keeps both runtime modes (Electron + standalone) working without a separate main-process bridge. See `docs/g-command.md` for the worked example.

Relay channels are one-way by construction: the server never reads from them. Interactive flows (request → response → next state) belong on HTTP, not on a relay.

