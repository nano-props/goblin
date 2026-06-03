# Project Notes

## Core conventions

- Pin new package versions exactly in `package.json`; no range prefixes.
- Use repo-alias imports with explicit `.ts`/`.tsx` extensions. Import canonical modules directly; do not add re-export shims.
- Verify with `bun run typecheck` and `bun run test` (`bun run test:watch` for watch mode).
- Keep examples, tests, docs, and snapshots privacy-safe: use generic placeholders, not real users, paths, emails, tokens, or internal identifiers.

## Git and safety

- Read-only git commands may run concurrently.
- Keep network git commands (`fetch`, `pull`, `push`) cancellable and coalesced per repo.
- Avoid destructive git features in the app. If one is introduced, design safety, cancellation, and recovery explicitly first.

## UI and copy

- English copy: Title Case for native menu items; sentence case for buttons, actions, headings, and help text; lowercase for status chips/badges such as `open`, `dirty`, `no upstream`.
- Preserve official casing (`GitHub`, `VS Code`, `PR`) and raw git/status data (`M`, `A`, `??`, branch names, paths).
- Prefer shadcn/ui primitives in `src/web/components/ui/`, adapted to app density, colors, and interaction states. For forms, reuse shared field primitives and keep spacing/layout stable.
- Display home-relative paths with `~` via existing `tildify` helpers.

## App architecture

- Keep app-level overlays in `src/web/hooks/useAppOverlays.ts`. Reuse `useOverlayRegistry.ts` only as a small boolean registry; keep dialog presentation and payload-specific state in components/domain hooks, and wire new app overlays through `closeAllOverlays()` plus any shared gates like shortcut or drag/drop suppression.
- Default to a single main `BrowserWindow` with in-app routing. Reuse `window-shell.ts`, `renderer-surface.ts`, and `window-registry.ts` for trusted renderer surfaces instead of inventing parallel window bootstrapping paths.
- Parent native dialogs to the actual RPC caller window when possible, and keep chrome sizing/colors in the shared window-chrome helpers.
- Only add auxiliary windows when the product genuinely needs a separate renderer surface. If an auxiliary window owns meaningful in-memory state, wire the close-time lifecycle flush path.
- Treat `src/server/` as the application runtime boundary. New repo, terminal, session, sync, settings, and realtime business logic should go in `src/server/` or `src/shared/` first, then be consumed by `src/web/` and Electron.
- Keep `src/main/` limited to Electron-native shell concerns: window lifecycle, preload bridging, menus, shortcuts, native dialogs, dock/badge/notifications, trusted renderer security policy, and embedded server lifecycle. Do not add repo, terminal, settings, or session business ownership back into `src/main/` unless the browser path cannot support it.
- When a main-process feature needs app data, prefer reading/writing through the embedded server contract instead of introducing new main-owned state. Main should act as a native host and thin adapter, not as a parallel business runtime.
- Keep the architecture guard green with `bun run check:architecture`. The enforced boundaries are:
  - `src/main/**` must not import `src/web/**` or `src/server/**`.
  - `src/web/**` must not import `src/main/**`.
  - `src/server/**` and `src/shared/**` must not import `electron`.

## Realtime and renderer model

- Prefer WebSocket invalidation + targeted refetch for cross-window data; use streaming only for UX-critical continuous flows like terminal output. Document each new WebSocket path as invalidation or streaming and why refetch/polling is insufficient.
- Treat the backend (embedded or standalone server mode) as the primary runtime. Design renderer behavior around the server contract first.
- Treat Electron renderers as specialized browser clients, not a separate privileged app architecture. Prefer shared server-backed terminal/session/realtime paths across web and Electron.
- Keep terminal identity semantics aligned across web and Electron:
  - `clientId` = logical renderer client / session owner.
  - `attachmentId` = specific renderer attachment under that client.
  - Reconnect, mirror, and takeover should be described and implemented in client/attachment terms, not Electron-only window terms.
- Prefer terminal/session/realtime fixes in the shared server-backed bridge or protocol layer. Add Electron-specific behavior only when the browser path cannot support it, and document the reason.

## Server-first renderer architecture

- Treat the embedded/server mode backend as the primary application runtime. Renderer behavior should be designed around the server contract first, then adapted for Electron convenience where needed.
- Treat Electron renderers as specialized browser clients, not as a separate privileged app architecture. Prefer sharing the same server-backed terminal/session/realtime paths between web and Electron.
- Keep client identity and attachment semantics aligned across web and Electron:
  - `clientId` identifies the logical renderer client / session owner.
  - `attachmentId` identifies a specific page/window attachment under that client.
  - Reconnect, mirror, and takeover behavior should be explained and implemented in those terms, not in Electron-only window terms.
- Prefer implementing terminal, realtime, and session lifecycle fixes in the shared server-backed bridge or protocol layer so web and Electron inherit the same behavior by default.
- Only add Electron-specific terminal behavior when the browser path cannot support the requirement. When this happens, document why the divergence is necessary.
