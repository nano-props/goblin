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
| Composer Upload  | native path attempt + HTTP fallback | HTTP upload |
| Mobile paste btn | unsupported                         | unsupported |

Both runtimes use the same classification, authority, upload, and error
contract. The resulting path may differ because path resolution depends on the
runtime filesystem boundary. A proven native path does not upload file content
and therefore is not subject to upload size limits.

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

Each uploaded blob is capped at 25 MiB. The client uses approximately 32 MiB of
uploaded blob content as the normal batch target after native path resolution,
so directly readable native paths do not contribute to it. The encoded
multipart request has a 34 MiB hard limit that bounds memory use and tolerates
modest multipart overhead or small differences from clients. The server
independently enforces the per-file limit before writing.

## Error surface

- Upload success requires exactly one returned path for every requested file.
  Missing, empty, or malformed results reject the complete action.
- Unsafe returned paths reject the complete action even after temporary-file
  fallback; no partial path list is written.
- Per-file, per-batch content, and 256-blob upload-count violations are
  reported before transfer with an actionable limit-specific error. Native
  paths do not consume this upload allowance. The authenticated server route
  independently validates the decoded batch before creating temporary storage
  or writing any file. Access-token admission occurs before body parsing, and
  the encoded request cap bounds each accepted request; the server-side count
  check protects persistence and inode usage rather than treating an authorised
  caller as an anonymous hostile transport peer.
- Remote terminal targets do not offer Composer Upload. File paste and drop are
  rejected before native-path resolution or upload because neither result is
  readable by the remote shell.
- Composer resolution, upload, limit, and concurrent-draft failures leave the
  existing draft unchanged. A concurrent-draft failure asks the user to retry;
  it never overwrites or replays against newer input.
- An escaped path list that exceeds the terminal input boundary is rejected
  rather than partially written.
- If the selected terminal can no longer accept input, the action stops without
  resolving or replaying files and tells the user to retry.

## Architectural invariants

- **Capture-phase paste listener** on the session root fires before xterm.js's descendant listener. Both `preventDefault()` and `stopPropagation()` are needed — `preventDefault` alone does not stop xterm's JS handler from reading `clipboardData.getData('text/plain')`.
- **Synchronous routing**: classification completes before asynchronous file
  resolution, so event suppression occurs during the capture-phase tick.
- **Controller gate**: paste and drop apply the same authority rule. Viewers
  silently ignore file input; native text paste retains xterm semantics.
- **Shared resolution contract**: Electron and web backends differ only behind
  the file-resolution boundary.
- **Ordered, complete resolution**: returned paths preserve input order and are
  written only after every input has exactly one safe path.
- **User-controlled, non-blocking completion**: asynchronous file paste and drop
  do not reserve or pause PTY input. Progress remains visible while the user is
  free to continue typing; the resolved path is written when ready, so intervening
  user input may arrive first.
- **No hidden coordination**: the client does not queue, compensate, or replay
  input. The captured writer stays bound to its original runtime generation, so
  an invalidated late result fails instead of being redirected. Shell-reported
  progress takes priority over local file-processing progress.

## Acceptance

Manual matrix (each gesture, on each runtime, with an oversized blob to confirm
the upload cap and an oversized native file to confirm path-only resolution):

- Electron: drop, paste, and Composer Upload from Finder / Explorer / Nautilus;
  paste an image from a browser (blob-save path).
- Web: drop, paste, and Composer Upload via the OS file manager; paste an image.
- Composer: confirm an oversized blob rejection preserves the existing draft;
  on Electron, an oversized native file inserts its path without uploading.
- Remote terminal: confirm Composer Upload is absent, while paste and drop reject
  before file resolution and leave terminal input and Composer draft unchanged.
- Linux: paste a file from Nautilus — confirms URI list is dropped, not written as literal `file://`.
- Excel: paste a single cell value, a single row, and a multi-row range — text wins in all three cases, no `/tmp/...png` path appears.
