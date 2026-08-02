# Terminal: paste file from clipboard

## Background

Terminal paste and drag-and-drop are two gestures for supplying the same
external content. They share one resolution contract so equivalent input has
equivalent behavior in Electron and web clients.

## Goal

Make paste and drop symmetric on Electron and web runtimes.

## Non-goals

- Mobile toolbar paste button — separate UX change.
- Remote terminal targets.
- Image preview / iTerm2 image protocol — write the path, the user opens it.
- Platform-specific clipboard path formats beyond the runtime's standard file
  path capability.
- Multi-line paste confirmation dialog — xterm.js's native handler + bracketed paste mode is sufficient.

## User-facing behavior

|                  | Electron                            | Web         |
| ---------------- | ----------------------------------- | ----------- |
| Drag-and-drop    | native path attempt + HTTP fallback | HTTP upload |
| Paste (Cmd+V)    | native path attempt + HTTP fallback | HTTP upload |
| Mobile paste btn | unsupported                         | unsupported |

Both runtimes use the same classification, authority, size, and error contract.
The resulting temporary path may differ because path resolution depends on the
runtime filesystem boundary.

## Resolver

Two-tier, runtime-agnostic:

1. **Path attempt** — use a native absolute path only when the runtime can prove
   that the PTY can read the same filesystem location.
2. **Blob save** — persist unresolved file blobs through the runtime backend and
   return bounded temporary paths accessible to the PTY.

If a native path-attempt result contains terminal control bytes, the resolver
treats that file as a blob-save candidate instead of dropping it. This keeps
legitimate filenames usable through a sanitized temporary path.

The session writes the shell-escaped path list through the normal terminal input
boundary.

## Path-aware decision matrix

When both `text/plain` and `Files` are present on the same paste event (Excel-style copy is the canonical case), the router must decide which wins. Signals, in priority order:

| `text/plain`                                | Files | Decision | Trigger                                                                                                |
| ------------------------------------------- | ----- | -------- | ------------------------------------------------------------------------------------------------------ |
| empty                                       | any   | files    | no text to compare                                                                                     |
| URI list (`file://…` per line)              | any   | files    | Linux file copy renders the URI list both as `text/uri-list` and `text/plain` — text is redundant      |
| **contains `\t`**                           | any   | **text** | tab is the load-bearing tabular signal — single-row and multi-row Excel / Numbers / Sheets copies      |
| multi-line + every line is an absolute path | files | files    | path-list text is treated as another representation of the file payload                                |
| multi-line + non-path-like                  | files | text     | OCR output alongside an image, multi-line prose — text is real data                                    |
| single-line + looks like a path             | files | files    | Windows single-file copy puts the path in `text/plain` (`C:\…`); resolver produces a shell-quoted path |
| single-line + plain text                    | files | **text** | single-cell Excel values like `"42"`, prose, code snippets, URLs — text wins, xterm handles natively   |
| any non-empty                               | none  | text     | xterm.js handles it natively                                                                           |
| empty                                       | none  | no-op    | xterm's own handler will no-op                                                                         |

Routing uses shared, runtime-neutral classification for URI lists, multi-line
absolute path lists, and single absolute paths. Non-file URIs are deliberately
excluded from path classification.

The routing decision is synchronous and side-effect free. File resolution runs
asynchronously only after the capture-phase handler has committed the routing
decision. This split lets the handler stop the event before it reaches
xterm.js's descendant textarea listener.

**Don't preventDefault on the text branch.** xterm.js's native paste handler reads `text/plain` itself and wraps with `\x1b[200~…\x1b[201~` when the shell has enabled bracketed-paste mode. Letting it run is what gives the user correct bracketed-paste semantics for free.

## Size cap

Each file is capped at 10 MiB. The client enforces the per-file limit before
upload; the HTTP body limit bounds the batch; and the server checks every file
again before writing. Batch transport limits include bounded multipart
overhead.

## Error surface

- Total transfer failure reports that no paths are available.
- A backend result that resolves only part of its requested files reports the
  resolved paths and failed remainder. A rejected upload is a total backend
  failure; the client does not claim partial success from files written before
  that rejection.
- Unsafe returned paths are rejected even after temporary-file fallback.
- Per-file size violations are reported before transfer.
- An escaped path list that exceeds the terminal input boundary is rejected
  rather than partially written.

## Architectural invariants

- **Capture-phase paste listener** on the session root fires before xterm.js's descendant listener. Both `preventDefault()` and `stopPropagation()` are needed — `preventDefault` alone does not stop xterm's JS handler from reading `clipboardData.getData('text/plain')`.
- **Synchronous routing**: classification completes before asynchronous file
  resolution, so event suppression occurs during the capture-phase tick.
- **Controller gate**: paste and drop apply the same authority rule. Viewers
  silently ignore file input; native text paste retains xterm semantics.
- **Shared resolution contract**: Electron and web backends differ only behind
  the file-resolution boundary.

## Acceptance

Manual matrix (each gesture, on each runtime, with at least one oversized file to confirm the size cap surfaces as documented):

- Electron: drop file from Finder / Explorer / Nautilus, paste from same, paste an image from browser (blob-save path).
- Web: drop / paste file via OS file manager, paste an image.
- Linux: paste a file from Nautilus — confirms URI list is dropped, not written as literal `file://`.
- Excel: paste a single cell value, a single row, and a multi-row range — text wins in all three cases, no `/tmp/...png` path appears.
