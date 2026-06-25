# Terminal: paste file from clipboard

## Background

Today the terminal slot accepts external content only via drag-and-drop. `Cmd/Ctrl+V` falls through to xterm.js's native text-only paste — copying a file in Finder and pasting produces nothing. Web clients have the same gap (`pathForDroppedFile` returns `''`, no equivalent IPC for paste). This PR closes the paste path on both Electron and web by routing paste through the same resolver drag-and-drop already uses.

## Goal

Make paste and drop symmetric on both runtimes. Mobile toolbar paste button is deferred.

## Non-goals

- Mobile toolbar paste button — separate UX change.
- Remote (SSH) worktrees — no SSH support yet.
- Image preview / iTerm2 image protocol — write the path, the user opens it.
- OS-clipboard path formats (`clipboard.readBuffer('FileNameW')`, etc.) — cross-platform cost is high and `webUtils.getPathForFile` covers the common case.
- Multi-line paste confirmation dialog — xterm.js's native handler + bracketed paste mode is sufficient.

## User-facing behavior

|                  | Electron                   | Web            |
| ---------------- | -------------------------- | -------------- |
| Drag-and-drop    | ✅ path-attempt + IPC save | ✅ HTTP upload |
| Paste (Cmd+V)    | ✅ path-attempt + IPC save | ✅ HTTP upload |
| Mobile paste btn | ❌ deferred                | ❌ deferred    |

Both gestures route through the same `resolvePastedFiles` resolver, so the user-visible behaviour is identical for a given runtime.

## Resolver

Two-tier, runtime-agnostic:

1. **Path attempt** — Electron's `webUtils.getPathForFile` returns absolute paths for files copied from the OS filesystem. The web bridge returns `''`, so this tier is skipped on web.
2. **Blob save** — persist remaining blobs via the runtime backend. Electron writes through IPC to `<os.tmpdir>/goblin-clipboard-<pid>/`; web POSTs multipart to `/api/clipboard/files`, which writes to `<serverDataDir>/clipboard-tmp-<pid>/`. Returns absolute paths the PTY can read.

If a native path-attempt result contains terminal control bytes, the resolver now treats that file like a blob-save candidate instead of dropping it. That keeps legitimate-but-dirty filenames usable by falling back to a sanitised temp-file path.

The slot writes the shell-escaped path list to PTY via the existing `writeInput` channel.

## Path-aware decision matrix

When both `text/plain` and `Files` are present on the same paste event (Excel-style copy is the canonical case), the router must decide which wins. Signals, in priority order:

| `text/plain`                                | Files | Decision | Trigger                                                                                                                                                           |
| ------------------------------------------- | ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| empty                                       | any   | files    | no text to compare                                                                                                                                                |
| URI list (`file://…` per line)              | any   | files    | Linux file copy renders the URI list both as `text/uri-list` and `text/plain` — text is redundant                                                                 |
| **contains `\t`**                           | any   | **text** | tab is the load-bearing tabular signal — single-row and multi-row Excel / Numbers / Sheets copies                                                                 |
| multi-line + every line is an absolute path | files | files    | defensive coverage for platforms that put newline-separated absolute paths in `text/plain` (Windows Explorer's multi-file copy behaviour is the main uncertainty) |
| multi-line + non-path-like                  | files | text     | OCR output alongside an image, multi-line prose — text is real data                                                                                               |
| single-line + looks like a path             | files | files    | Windows single-file copy puts the path in `text/plain` (`C:\…`); resolver produces a shell-quoted path                                                            |
| single-line + plain text                    | files | **text** | single-cell Excel values like `"42"`, prose, code snippets, URLs — text wins, xterm handles natively                                                              |
| any non-empty                               | none  | text     | xterm.js handles it natively                                                                                                                                      |
| empty                                       | none  | no-op    | xterm's own handler will no-op                                                                                                                                    |

Routing is split between `src/shared/clipboard-paste.ts` and `src/web/clipboard/process.ts`:

- `looksLikeUriList(text)` — RFC 2483: every significant line must start with `file://`.
- `looksLikeAbsolutePathList(text)` — multi-line absolute paths (POSIX `/…`, Windows drive letter `C:\…`, UNC `\\…`). Non-file URIs deliberately excluded.
- `isAbsolutePathLike(line)` — single-line primitive used by both the multi-line predicate and the single-line + files branch.

The router itself is `previewPaste({ text, files }) → PastePreview` in `src/web/clipboard/process.ts` — synchronous, side-effect free. When it returns `'files'`, `TerminalSlot` then calls `resolvePastedFiles(files)` asynchronously. The slot uses this split so it can call `event.preventDefault()` / `event.stopPropagation()` before the event reaches xterm.js's descendant textarea listener.

**Don't preventDefault on the text branch.** xterm.js's native paste handler reads `text/plain` itself and wraps with `\x1b[200~…\x1b[201~` when the shell has enabled bracketed-paste mode. Letting it run is what gives the user correct bracketed-paste semantics for free.

## Size cap

`PASTE_FILE_MAX_BYTES = 10 MiB` in `src/shared/clipboard-paste.ts`, enforced at three layers (client → IPC → server `bodyLimit`). Server batch limit is `PASTE_FILE_MAX_BYTES + 2 MiB` to cover multipart overhead. The client per-file check produces a user-friendly `terminal.paste-file-too-large` toast before any IPC traffic; the server batch limit produces a generic 413 — defense-in-depth against bypassed clients.

## Error surface

i18n keys (`terminal.paste-file-*`):

- `paste-file-failed` — backend transfer failed, no paths available
- `paste-file-partial` — some paths resolved, at least one backend transfer failed
- `paste-file-unsafe` — even after resolver fallback, the final returned paths still contained terminal control characters
- `paste-file-too-large` — file exceeded the size cap
- `paste-file-overflow` — escaped paths exceeded the WebSocket payload guard

## Architectural invariants

- **Capture-phase paste listener** on the slot root fires before xterm.js's descendant listener. Both `preventDefault()` and `stopPropagation()` are needed — `preventDefault` alone does not stop xterm's JS handler from reading `clipboardData.getData('text/plain')`.
- **Synchronous routing**: `previewPaste` runs before any `await`, so the `preventDefault` / `stopPropagation` calls land in the capture-phase tick.
- **`isController` gate** matches between paste and drop — viewers / mirrors silently no-op for files; text paste still flows through xterm.
- **Same resolver on both runtimes** — `resolvePastedFiles` is the single entry point; the runtime dispatch is hidden inside `saveClipboardFiles`.

## Follow-ups

- **Mobile toolbar paste button** — `navigator.clipboard.read()`-based dispatch on `clipboardItem.types`.
- **OS-clipboard path formats** — `clipboard.readBuffer('FileNameW')` / NSFilenamesPboard prepended before the current path-attempt.
- **Remote-host detection** — when SSH lands, surface `terminal.paste-file-remote` toast before the resolver runs.
- **Image preview / iTerm2 image protocol**.
- **"Copy to my machine" download route** for LAN web deployments.

## Verification

Manual matrix (each gesture, on each runtime, with at least one oversized file to confirm the size cap surfaces as documented):

- Electron: drop file from Finder / Explorer / Nautilus, paste from same, paste an image from browser (blob-save path).
- Web: drop / paste file via OS file manager, paste an image.
- Linux: paste a file from Nautilus — confirms URI list is dropped, not written as literal `file://`.
- Excel: paste a single cell value, a single row, and a multi-row range — text wins in all three cases, no `/tmp/...png` path appears.
