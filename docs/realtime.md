# Realtime

Use this doc for realtime transport and lifecycle rules.

- Prefer WebSocket invalidation plus targeted refetch for cross-window data.
- Use streaming only for UX-critical continuous flows such as terminal output.
- Document whether a new realtime path is invalidation or streaming.
- Explain why polling or refetch is not enough when adding a new realtime path.
- Prefer fixes in the shared server-backed bridge or protocol layer.
- Add Electron-specific realtime behavior only when the browser path cannot support the requirement.
