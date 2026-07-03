# Architecture

Use this doc for app shell and process control rules.

- Keep one primary `BrowserWindow` by default. Add extra windows only when the product really needs a separate surface.
- Put app logic in `src/server/` or `src/shared/`.
- Keep `src/main/` focused on Electron-native host work; the architecture term is `native host`.
- Keep overlays centralized in `src/web/hooks/useAppOverlays.ts`.
- Route menu and UI actions through client/server intent flows when possible.
- Use direct native-host actions only for native-only work.
- Let the server own settings and app data.
- Prefer server-first runtime authority. The client should send intent plus explicit preconditions, and the server should accept or reject with fast-fail semantics.
- Model runtime lifecycle as server-owned state transitions, not client-synchronized snapshots. For repo instances this means the server mints the live `repoInstanceId` on open and invalidates it on close/reopen.
- Do not treat a stable locator such as `repoRoot` as a full runtime identity when reopen/recreate can mint a new live instance.
- Do not add client-side freshness heuristics when the server can reject stale work directly. Push runtime validity checks into shared protocol contracts first, and let stale mutations fail instead of trying to "heal" them in the client.
- When a server-owned runtime id already identifies the write target precisely enough, use that id directly and let the server decide. Do not add a second client-side freshness dependency "just in case" if it can only make a valid server action fail locally.
- Server push should be the default way client projections converge after a successful write. Avoid immediate client-issued read-backs on the same path unless the server contract truly cannot return or broadcast the authoritative post-write state.
- Centralize web-side settings writes in `src/web/settings-actions.ts`; `src/web/settings-client.ts` is the HTTP/native transport boundary. Components should not call raw settings write functions directly.
- Keep query key/cache helpers separate from React hooks: use `settings-query-cache.ts` for cache keys and cache updates, and `settings-queries.ts` for React Query hooks.
- Let the native host project native state instead of owning parallel state.
- Use `embedded server` for the server spawned by the native host.
