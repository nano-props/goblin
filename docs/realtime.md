# Realtime

Use this doc for realtime transport and lifecycle rules.

- Prefer WebSocket invalidation plus targeted refetch for cross-window data.
- Use streaming only for UX-critical continuous flows such as terminal output.
- Document whether a new realtime path is invalidation or streaming.
- Do not use polling (`refetchInterval`, `setInterval`, repeated timers) as a runtime-coherent read model. If server-owned state can change after the initial read, the server must publish invalidation or stream the change.
- Explain why one-shot invalidation/refetch or streaming is the right realtime category when adding a new realtime path.
- Prefer fixes in the shared server-backed bridge or protocol layer.
- `/ws/app` does not queue, throttle, or retry for a slow reader. Each outbound
  message remains atomic. Before sending another message, the server terminates
  the connection if the raw WebSocket sender already retains more than 16 MiB.
  This bounds sustained accumulation rather than imposing a strict 16 MiB cap
  at every instant: one atomic message may carry the retained bytes past the
  threshold. Reconnect/recovery then restores the client projection.

## Channels and message categories

The browser uses two authenticated WebSocket channels:

- `/ws/app` owns runtime requests, continuous terminal output, and workspace
  pane events. Its connection participates in client presence, and transition
  responses precede buffered runtime effects.
- `/ws/notifications` carries lightweight invalidations and client effect
  intents on one connection. It does not participate in runtime presence or
  terminal transition ordering.

Classify each realtime message by its meaning, independently of its transport:

- **Invalidation**: server state changed; the subscriber should refetch.
- **Streaming**: the server is producing a continuous event stream.
- **Relay**: an external action requests a browser view change. One envelope
  per trigger; it neither implies refetch nor acknowledges execution.

Invalidations retain their user-scoped or global broadcast audience. Client
intents retain their broadcast audience but go only to connections whose
browser currently subscribes to those intents. The notification connection
accepts a bounded `{type: "client-intent-subscription", enabled: boolean}`
declaration at open and when that subscription changes. A data-only listener
is not a client-intent receiver. A command with no receiver returns `NO_CLIENT`;
an existing receiver does not guarantee that its view action executed.

When an action originates outside the client (CLI or external integration),
use the server relay pattern. The server delivers the intent to authenticated
browser receivers. See `docs/g-command.md` for the worked example.

The notification channel accepts subscription declarations only. Business
commands enter through HTTP; runtime request/response flows use `/ws/app`.
