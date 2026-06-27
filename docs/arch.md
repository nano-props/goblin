# Architecture

Use this doc for app shell and process control rules.

- Keep one primary `BrowserWindow` by default. Add extra windows only when the product really needs a separate surface.
- Put app logic in `src/server/` or `src/shared/`.
- Keep `src/main/` focused on Electron-native host work; the architecture term is `native host`.
- Keep overlays centralized in `src/web/hooks/useAppOverlays.ts`.
- Route menu and UI actions through client/server intent flows when possible.
- Use direct native-host actions only for native-only work.
- Let the server own settings and app data.
- Let the native host project native state instead of owning parallel state.
- Use `embedded server` for the server spawned by the native host.
