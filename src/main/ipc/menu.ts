// Menu IPC. Currently a no-op wiring file — the menu sends pushes to
// the renderer (`app:menu-invoke`), but renderer doesn't currently
// invoke main from menu actions. Kept as a separate file so future
// menu-driven IPC (e.g. "About" dialog) has a clear home.

export function wireMenuIpc(): void {}
