# Architecture

Use this doc for app shell and process control rules.

- Keep one main `BrowserWindow` by default. Add extra windows only when the product really needs a separate surface.
- Put app logic in `src/server/` or `src/shared/`.
- Keep `src/main/` focused on Electron-native shell work.
- Keep overlays centralized in `src/web/hooks/useAppOverlays.ts`.
- Route menu and UI actions through client/server intent flows when possible.
- Use direct main-process actions only for native-only work.
- Let the server own settings and app data.
- Let main project native state instead of owning parallel state.
