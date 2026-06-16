# Terminal: paste file from clipboard

> **Status**: design draft, no implementation yet.
> Tracking PR: see the linked draft PR.

## Background

The terminal slot today has two disjoint mechanisms for moving external content into the PTY:

- **Drag-and-drop files** (`TerminalSlot.tsx` → `handleDrop`): reads `event.dataTransfer.files`, calls `pathForDroppedFile` to resolve an absolute path through the Electron bridge, and writes the shell-escaped path(s) to the PTY.
- **Clipboard text** (mobile toolbar `Paste` button → `handleToolbarPaste`): uses `navigator.clipboard.readText()` and writes the result.

Neither path handles the common case where a user copies a file in Finder/Explorer and presses `Cmd/Ctrl+V` (desktop) or taps the `Paste` button (mobile) inside the terminal. `navigator.clipboard.readText()` returns an empty string for non-text clipboard content, and xterm.js' native paste handling has no file semantics, so the user sees nothing happen with no error feedback.

The web renderer (`serve.sh` / `scripts/start-server.ts`) has the same gap. Web drag-and-drop today is silently a no-op (`WEB_RENDERER_CAPABILITIES = []`, `pathForFile` returns `''`), and web paste is also silently a no-op for files. This PR closes both gaps on web by routing both drop and paste through the same `resolvePastedFiles` resolver backed by a new HTTP upload route.

## Goal

Make "paste file" work the same way "drop file" already does, on both desktop and mobile flows, on both Electron and web renderers. Stay within the existing terminal state model (controller / viewer / mirror) and the existing renderer-bridge / server-route surfaces.

## Non-goals (first iteration)

- **Remote (SSH) worktrees.** Out of scope for the first iteration — the codebase has no SSH terminal support yet, so there is no remote-controller case to surface. When SSH lands, the controller-attached-to-remote case must be detected (via `attachment.role` / `processName` / SSH plumbing — see `docs/terminal-target-model.md`) and a `terminal.paste-file-remote` toast introduced; tracked as a follow-up.
- **Files larger than a configurable cap** (proposed: 10 MiB, exposed as `PASTE_FILE_MAX_BYTES` in `src/shared/`). Pasting a 2 GB ISO into a shell prompt is rarely what the user wants; we refuse with a toast and suggest an external transfer (shell `scp`/`rsync`, file manager, or a real upload flow). Drag-and-drop is **not** suggested as an alternative — it shares the same cap and would be rejected for the same reason.
- **Image preview / inline thumbnails.** Even if xterm supports the iTerm2 image protocol, the minimum useful behavior is to write a path the user can open. Inline image support is a follow-up.
- **OS-clipboard path formats on Electron** (`clipboard.readBuffer('FileNameW')` / NSFilenamesPboard / `text/uri-list`). These formats would let the path-attempt step skip the blob upload in some cases, but the cross-platform implementation cost is high and `webUtils.getPathForFile` already covers the common case. See §"Follow-ups".

## User-facing behavior

After this PR, the terminal slot accepts file content through two gestures on both Electron and web:

|  | Electron app | Web (`serve.sh`) |
|---|---|---|
| **Drag-and-drop** | ✅ via `pathForDroppedFile` + IPC save | ✅ via HTTP upload (new) |
| **Paste (`Cmd+V` / mobile toolbar)** | ✅ via `pathForDroppedFile` + IPC save | ✅ via HTTP upload (new) |

### Desktop (Electron)

1. User focuses the terminal and presses `Cmd+V` (macOS) or `Ctrl+V` (Linux/Windows).
2. If the clipboard contains file(s) — files win over text (see §2 handler and §9 "Linux text/uri-list mixed with text"):
   - For each file, ask the main process for its filesystem path via `webUtils.getPathForFile(file)`. Files with a path are written to the PTY as a shell-escaped space-separated list.
   - Files without a path (e.g. an image copied from a browser tab) are written to a temp dir under `<os.tmpdir>/goblin-clipboard-<pid>/` and their absolute paths are appended to the list.
   - If the PTY is a remote mirror (controller attached to a remote host), do not write anything. A future SSH iteration will surface a specific toast here; for now the handler's existing `!isController` gate silently no-ops, matching today's behavior for non-controllers.
   - If the resolution fails, show `terminal.paste-file-failed`.
3. If the clipboard contains only text (no files), xterm pastes it as today (no change).
4. Drag-and-drop continues to work as today — files dropped from Finder/Explorer or another app are passed through the same resolver, so a dropped image blob (no path) is also written to the temp dir and echoed.

### Mobile (Electron + web, existing toolbar `Paste` button)

1. The button currently calls `navigator.clipboard.readText()`. After this change:
   - Try `navigator.clipboard.read()` first to detect image / file blobs.
   - If files are present, route them through the same resolver as the desktop path.
   - If only text is present, keep the current `readText` behavior.
2. UX contract: a successful file paste produces a visible result (paths echoed into the PTY) and a successful text paste produces its text — never silently nothing.

### Web renderer scope

The web renderer has zero native capabilities today (`WEB_RENDERER_CAPABILITIES = []`), so `webUtils.getPathForFile` is unavailable. The resolver collapses to:

1. **Path attempt** — `pathForFile(file)` returns `''` for every file. Falls through.
2. **Blob save** — upload each file via `POST /api/clipboard/files`. The server writes to `<serverDataDir()>/clipboard-tmp-<pid>/` and returns absolute paths the PTY can read.

Both **drop** and **paste** route through this same resolver on web, so the two gestures are symmetric: drop a file from Finder onto the web terminal and the server writes it to a temp path; copy a file in Finder and `Cmd+V` in the web terminal, same outcome.

Behavior contract on web:

- A `paste` event with at least one file uploads to the server, regardless of any `text/plain` presence (files-first ordering — see §9 "Linux text/uri-list mixed with text"). On success, paths are echoed into the PTY. On failure (server unreachable, batch exceeds 12 MiB at `bodyLimit`, server error), the user sees `terminal.paste-file-failed`. (Single-file oversize is intercepted earlier in the renderer with `paste-file-too-large`, not here.)
- A `drop` event with files uploads to the server. Same success / failure surface as paste. The existing `dragOver` indicator (the dashed border on the slot) is preserved unchanged.
- A `paste` event with text continues to flow through xterm as today; the resolver is not consulted.
- The paste handler's `isController` gate applies on web exactly as on desktop (viewers and mirrors silently no-op for files; text still flows through xterm). The drop handler's `!key` gate is identical between web and Electron. Remote-host detection is deferred (see §"Follow-ups").
- CORS / same-origin: the renderer hits its own origin (the same `initialServer.url` it already uses for `/api/repo`, `/ws`, etc.), so CORS is satisfied by the existing predicate in `app-factory.ts`.
- **LAN caveat**: when the server is bound to `0.0.0.0` and the renderer is on a different machine, the written path lives on the server, not on the user's machine. The PTY (also on the server) can read it, so the existing pipeline works unchanged — but the user cannot double-click the path to open it locally. This matches the existing model (any path the user sees in a web-mode terminal is a server-side path) and is acceptable for the first iteration. A "copy to my machine" download route would be a separate feature.

## Implementation

### 1. Shared constants

Add one small module to keep the size cap in one place:

```ts
// src/shared/clipboard-paste.ts (new)
export const PASTE_FILE_MAX_BYTES = 10 * 1024 * 1024  // 10 MiB
```

Four call sites read it. **The cap is per-file**, not per-batch:

- Paste handler (§2): early bail-out when any `file.size > PASTE_FILE_MAX_BYTES`, then surface `terminal.paste-file-too-large`.
- Drop handler (§7): same check, same toast key.
- Main process (`saveClipboardFiles` IPC handler): reject if any single file's bytes exceed `PASTE_FILE_MAX_BYTES`.
- Server (`createClipboardRoutes`): the `bodyLimit` middleware is per-batch, sized at `PASTE_FILE_MAX_BYTES + 2 MiB` (multipart overhead). This is intentional: a multi-file batch where each file is under the cap but the sum exceeds 12 MiB will be rejected at the transport layer with a generic 413, mapping to `terminal.paste-file-failed` (not "too-large") in the UI. The cap protects the worker; the per-file check protects the user from pasting a single huge blob.

### 2. Web: capture-phase paste on the slot

Add a capture-phase `paste` listener on the slot root in `TerminalSlot.tsx`, parallel to the existing `onDrop` handler. xterm receives its own copy because capture-phase handlers run before the event reaches xterm's DOM, and we only call `preventDefault()` when we actually handle it.

```ts
const handlePasteCapture = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
  if (!key || !isController) return                       // viewer / mirror: do nothing

  // Files FIRST. On Linux a file copy carries `text/uri-list` *and* a
  // `text/plain` rendering of the same URI list; if we let text win the
  // user sees a literal `file:///home/user/foo.png` string in the PTY.
  // See §9 ("Linux text/uri-list mixed with text") for the full reasoning.
  const files = collectClipboardFiles(event.clipboardData)
  if (files.length > 0) {
    const oversized = files.find((f) => f.size > PASTE_FILE_MAX_BYTES)
    if (oversized) {
      event.preventDefault()
      toast.error(t('terminal.paste-file-too-large'))
      return
    }

    event.preventDefault()
    event.stopPropagation()
    void resolvePastedFiles(files).then(({ paths, failed }) => {
      if (paths.length === 0) {
        toast.error(t('terminal.paste-file-failed'))
        return
      }
      writeInput(key, paths.map(shellEscapePath).join(' '))
      if (failed > 0) toast.error(t('terminal.paste-file-partial'))
    })
    return
  }

  // No files: if there's text, let xterm handle it (do NOT preventDefault).
  if (event.clipboardData.getData('text/plain').length > 0) return

  // Nothing useful — no files, no text. No-op, no toast.
}, [...])
```

One helper, new and small:

- `collectClipboardFiles(data)` — mirrors the existing drop semantics: prefer `data.files`, fall back to `data.items` (`kind === 'file'` → `getAsFile()`), filter out zero-byte entries that some platforms emit as placeholders. ~10 lines. Lives in `TerminalSlot.tsx`.

### 3. Web: two-tier path resolver

The resolver is runtime-agnostic. It tries each tier in order; the first non-empty result wins.

```ts
// web/clipboard/resolver.ts (new)
export interface PasteResolution {
  /** Absolute paths the PTY can read. May be non-empty even when `failed > 0`. */
  paths: string[]
  /**
   * Files that could not be resolved to a path. Counts both "no path available
   * and the blob-save backend returned no path for this file" — e.g. a
   * transport failure on a multi-file paste where the path-attempt tier
   * succeeded for some files. Surfacing this prevents silent partial loss:
   * if `failed > 0 && paths.length > 0`, the handler shows a `paste-file-partial`
   * toast in addition to writing the paths that did succeed.
   */
  failed: number
}

export async function resolvePastedFiles(files: File[]): Promise<PasteResolution> {
  // Path attempt: Electron's preload returns absolute paths for files copied
  // from the OS filesystem; the web bridge returns ''.
  const paths: string[] = []
  const blobOnly: File[] = []
  for (const file of files) {
    const p = pathForDroppedFile(file)
    if (p.length > 0) paths.push(p)
    else blobOnly.push(file)
  }
  if (blobOnly.length === 0) return { paths, failed: 0 }

  // Blob save: persist remaining blobs via the runtime backend. Both
  // Electron and web bridge implementations are designed to be
  // all-or-nothing — the backend writes every input or returns [].
  // The "partial failure" case arises at the resolver level, not the
  // backend: paths that resolved at the path-attempt tier already live
  // in `paths`, while the remaining blobs go to the backend. If the
  // backend returns fewer paths than blobOnly.length (e.g. transport
  // failure on a multi-file paste where some files had paths), each
  // missing entry counts as failed.
  const saved = await saveClipboardFiles(blobOnly)
  return {
    paths: paths.concat(saved),
    failed: Math.max(0, blobOnly.length - saved.length),
  }
}
```

The runtime dispatch happens inside `saveClipboardFiles` in `app-shell-client.ts`, not in the resolver:

```ts
// web/app-shell-client.ts (additions)
export function saveClipboardFiles(files: File[]): Promise<string[]> {
  return getRendererBridge().saveClipboardFiles(files)
}
```

`getRendererBridge().saveClipboardFiles` is the new single bridge method (see §4 and §5). The Electron branch wraps the IPC call; the web branch calls the HTTP route. Both return `string[]`; `[]` on failure.

### 4. New IPC surface (Electron)

Extend `src/shared/ipc-channels.ts` and the implementations in `src/main/` and `src/preload/preload.cjs`. One new channel, following the existing `goblin:<noun>-<verb>` convention:

```ts
export const CLIPBOARD_SAVE_BINARY_FILES_CHANNEL = 'goblin:clipboard-save-binary-files'
```

`src/web/renderer-bridge-types.ts` (renderer-side view) — narrow, the IPC payload shape is internal to the Electron implementation:

```ts
saveClipboardFiles(files: File[]): Promise<string[]>
```

The preload exposes it via the existing `safeInvoke` pattern. The web bridge delegates to `createHttpClipboardBackend` (see §5) — same method on both runtimes, different backing transport.

Main-process responsibilities (`src/main/clipboard-bridge.ts`, new):

- The preload converts each `File` to `{ name: string; bytes: ArrayBuffer }` via `arrayBuffer()` before invoking IPC, so the wire payload is plain structured-clone data. The main process does not call `arrayBuffer()`.
- Rejects if any single file's `bytes.byteLength` exceeds `PASTE_FILE_MAX_BYTES` (defense-in-depth; the renderer-side check should already have caught it).
- Writes under `<os.tmpdir>/goblin-clipboard-<pid>/` with timestamped names (`<ISO-timestamp>-<index>-<basename>`).
- On startup, prune the temp dir of files older than the previous run. This is a one-shot cleanup per process, not per-request — simpler and more correct than per-request pruning.
- Returns absolute paths.

### 5. New HTTP surface (web)

Add a single route to the server under `/api/clipboard/files`, parallel to the existing `/api/settings`, `/api/repo`, `/api/remote` mounts:

```
POST /api/clipboard/files
  Headers: x-goblin-internal-secret: <secret>
  Body:    multipart/form-data
             files: <binary blobs, repeated>
  200 OK:  { ok: true, paths: string[] }
  4xx/5xx: { ok: false, code, message }   // standard errorJson envelope
```

Concretely:

- New factory `createClipboardRoutes()` under `src/server/routes/clipboard.ts`, mounted in `app-factory.ts`. The mount point is `/api/clipboard`, which means the existing `cors` and `applyApiSecurityHeaders` middlewares (registered for `/api/*` in `app-factory.ts`) cover the new route automatically. **Auth is not** auto-applied: `createInternalAuthMiddleware` is only registered on `/api/settings/*`, `/api/repo/*`, `/api/remote/*`. Add an explicit `app.use('/api/clipboard/*', createInternalAuthMiddleware(options.internalSecret))` in `app-factory.ts` next to the existing auth registrations, before mounting the new routes.
- Per `docs/layering.md`, the route file is thin — it parses the multipart body, calls into the write layer, and returns the JSON envelope. Orchestration lives in a new `src/server/modules/clipboard-write-paths.ts` module, parallel to `settings-write-paths.ts` and `repo-write-paths.ts`.
- **Body limit**: the existing `bodyLimit({ maxSize: 1 MiB })` middleware on `/api/*` is too tight for 10 MiB blobs (multipart overhead included), and a per-route override registered *after* the global one does not actually take effect — `bodyLimit` checks Content-Length before calling `next`, so the global middleware rejects first. The fix is to move `bodyLimit` off the `/api/*` catch-all and onto the specific sub-paths that need it: `/api/settings/*`, `/api/repo/*`, `/api/remote/*` keep the 1 MiB cap (hostile-client defense); `/api/clipboard/*` registers its own `bodyLimit({ maxSize: PASTE_FILE_MAX_BYTES + 2 MiB })`. The behavior of every existing route is preserved — same paths, same limits, same 413 on overflow. This is a small refactor of `app-factory.ts` (move one `app.use` call from `/api/*` to three sub-paths) and must land in the same PR.
- The server writes to `<serverDataDir()>/clipboard-tmp-<pid>/` (re-using `serverDataDir()` from `src/server/common/data-dir.ts`), with timestamped names. Same startup-prune policy as the Electron tier: clean files from previous runs once per server process, not per request.
- The multipart body shape is fixed (repeated `files` field), so no valibot schema is needed. The route uses `await c.req.parseBody()` and normalises the result: Hono's `parseBody()` returns `Record<string, string | File | (string | File)[]>`, so the `files` key may surface as a single `File` (one uploaded file), a `File[]` (multiple), or absent (empty upload). The handler treats each value uniformly — coerce strings to a 400, collect files into a `File[]` — before passing to the write layer. If a future variant adds fields (e.g. worktree selection), introduce a `clipboard-save-files` schema in `procedure-schemas.ts` at that point.
- Returned `paths` are absolute paths on the **server machine**. On web mode this works because the server hosts the terminal PTY (`serverTerminalHost` in `app-factory.ts`), so a path the server can resolve is also a path the PTY can read.

Renderer side: the new web `PasteFileBackend` (effectively just `saveClipboardFiles` for web) calls this route. Implementation lives in `src/web/clipboard/http-backend.ts`, parallel to the existing `createServerTerminalBridge` template:

```ts
// web/clipboard/http-backend.ts (new)
export function createHttpClipboardBackend(config: {
  url: string          // initialServer.url from bootstrap
  secret: string       // initialServer.secret
}): {
  saveClipboardFiles(files: File[]): Promise<string[]>
} {
  return {
    async saveClipboardFiles(files) {
      const form = new FormData()
      for (const file of files) {
        // `file.name` is empty for blobs synthesized from clipboard data;
        // fall back to a stable placeholder so the multipart part is valid
        // and the server-side filename is at least traceable.
        const filename = file.name.length > 0 ? file.name : `paste-${Date.now()}.bin`
        form.append('files', file, filename)
      }
      const res = await fetch(new URL('api/clipboard/files', config.url), {
        method: 'POST',
        headers: { 'x-goblin-internal-secret': config.secret },
        body: form,
      })
      if (!res.ok) return []
      const json = await res.json() as { ok: boolean; paths?: string[] }
      return json.ok && Array.isArray(json.paths) ? json.paths : []
    },
  }
}
```

The bootstrap snapshot already carries `initialServer.url` and `initialServer.secret` (see `buildWebBootstrap` in `app-factory.ts`), so the backend has no new wiring. Construct it inside `webBridge()` in `src/web/renderer-bridge.ts`, parallel to the existing `createServerTerminalBridge` call, and return it as the `saveClipboardFiles` implementation of the web `RendererBridge`.

### 6. Mobile toolbar `Paste` button

Replace the body of `handleToolbarPaste` in `TerminalSlot.tsx` to try `navigator.clipboard.read()` first and dispatch on `clipboardItem.types`:

- `clipboardItem.types` contains **only** `text/plain` → existing text behavior.
- `clipboardItem.types` contains any file-shaped MIME (`image/*`, `application/pdf`, etc.), possibly **also** `text/plain` → prefer the file: wrap each non-text `Blob` from `clipboardItem.getType(type)` in a `File` via `new File([blob], "clipboard-{type-with-slash-replaced}", { type: blob.type })` (the resolver signature is `File[]`, not `Blob[]`, and clipboard blobs have no filename) and call `resolvePastedFiles` with the resulting `File[]`. Rationale: a file copy on macOS/Windows often carries a textual fallback (filename as text) alongside the actual blob; the user's intent is the file, not the text.
- `clipboardItem.types` contains neither → no-op (return early, no toast).

Wrap the call in `try/catch`. On rejection — `NotAllowedError` (permission denied / unfocused document), the API being unavailable, or any other reason — `console.warn` the error (with the original reason for debugging) and fall back to the existing `readText` path for text. Do not pretend to support files we cannot see.

### 7. Drag-and-drop on the slot

The existing `handleDrop` in `TerminalSlot.tsx:190` only calls `pathForDroppedFile`, which returns `''` on web — making drag-and-drop a silent no-op there. The fix is to route the file list through `resolvePastedFiles`, the same resolver paste uses. On Electron the path-attempt step still wins for filesystem files (the fast path is unchanged); on web it always falls through to the blob-save step. One function, two runtimes, identical UX.

```ts
const handleDrop = useCallback(
  (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setDragOver(false)
    if (!key) return                       // existing gate; do not write into a slot without a session
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return

    const oversized = files.find((f) => f.size > PASTE_FILE_MAX_BYTES)
    if (oversized) {
      toast.error(t('terminal.paste-file-too-large'))
      return
    }

    void resolvePastedFiles(files).then(({ paths, failed }) => {
      if (paths.length === 0) {
        toast.error(t('terminal.paste-file-failed'))
        return
      }
      writeInput(key, paths.map(shellEscapePath).join(' '))
      if (failed > 0) toast.error(t('terminal.paste-file-partial'))
    })
  },
  [key, writeInput],
)
```

Notes:

- The existing `setDragOver(false)` UI side-effect is preserved.
- The existing `!key` gate is preserved. The PR does **not** add an `isController` check here — that would be a behavior change to a path that's been live for a while, and is out of scope. Paste enforces `isController` (per §9) but drop continues to accept any slot with a `key`. If symmetry is wanted, that's a follow-up.
- Size enforcement and toast surface are identical to the paste handler — same i18n keys, same threshold.

### 8. i18n

New keys (en/zh/ja/ko), following the existing flat `terminal.<kebab>` convention. The keys are named after the **gesture** (paste), but the drop handler reuses them on purpose: a "file too large" toast is the same UX regardless of whether the user pasted or dropped. If the team wants gesture-specific copy, split later.

- `terminal.paste-file-failed` — resolver returned no paths
- `terminal.paste-file-partial` — some files resolved, some didn't (only shown when `failed > 0 && paths.length > 0`)
- `terminal.paste-file-too-large` — file exceeded the configured size cap

### 9. Error handling and edge cases

- **Viewer / mirror mode**: `handlePasteCapture` returns early; xterm paste (text) still works for viewers, but file paste requires controller authority. The drop handler does *not* enforce `isController` — it only checks `!key`, matching the existing pre-PR behavior. The asymmetry is intentional: paste is new code (so we apply the right gate from day one), drop is unchanged code (we don't ship behavior changes under the cover of a paste PR). Symmetry is a follow-up (§"Follow-ups").
- **Remote host**: deferred to follow-up (see §"Follow-ups"). The first iteration has no SSH, so there is no remote-controller case to handle. The existing `!isController` gate in the paste handler covers non-controllers (viewers, mirrors, unowned) by silently no-opping for files — this is the current behavior, preserved unchanged.
- **Size cap**: enforced at three layers, all reading `PASTE_FILE_MAX_BYTES` — renderer handlers (paste + drop, early bail with toast), the main-process IPC handler (defense-in-depth; rejects oversized payloads before reading bytes), and the server `bodyLimit` middleware (transport ceiling; per-batch, sized at `PASTE_FILE_MAX_BYTES + 2 MiB`). The server route handler itself does **not** re-check per-file size — the bodyLimit already bounds the request, and the renderer is the only legitimate source of paste/drop events, so adding a redundant check would be code without a purpose. Per-file intent is enforced at the renderer; per-batch transport safety is enforced at the bodyLimit.
- **Zero-byte files**: `collectClipboardFiles` filters them out. If filtering drops everything, the function returns and we do not `preventDefault`, so the user keeps their usual paste experience.
- **No file selected, only image**: still a file-like blob; we serialize it like any other binary and write the path. xterm will not preview it, but the user can open it.
- **Server unreachable (web only)**: the HTTP backend returns `[]` on network error, which maps to `terminal.paste-file-failed`. No silent failure.
- **Startup cleanup of stale temp files**: a single pruning pass on main / server startup. If the process crashes mid-write, leftover files from the previous run are removed on next boot. Per-request pruning is unnecessary.
- **Linux `text/uri-list` mixed with text**: when a file manager copies a file on Linux, the clipboard carries `text/uri-list` *and* `text/plain` (a textual rendering of the same URI list). The capture handler must check for files (`data.files` / `data.items` with `kind === 'file'`) **before** the text/plain bail-out — otherwise a Linux file copy is pasted as a literal `file:///home/user/foo.png` string. The handler ordering in §2 already does this (file check precedes text check); the helper `collectClipboardFiles` returns the file blobs, and the text fallback only fires when no files are present.

## Follow-ups (not in this PR)

- **OS-clipboard path formats on Electron.** `clipboard.readBuffer('FileNameW')` (Windows), NSFilenamesPboard (macOS), `text/uri-list` (Linux). When implemented, this would slot into the resolver as a *prepended* step before the current path-attempt: try `clipboard.readBuffer` first, fall through to `webUtils.getPathForFile` + blob save. Cross-platform cost is high; defer.
- **Drop `isController` parity.** Paste enforces controller authority; drop accepts any slot with a `key`. Tightening drop is a one-line check, but it's a behavior change to a path that's been live for a while, so it's deferred.
- **Remote-host detection.** When SSH terminal support lands, the controller-attached-to-remote case needs detection (via `attachment.role` / `processName` / SSH plumbing — see `docs/terminal-target-model.md`) and a new `terminal.paste-file-remote` toast surfaced from the paste handler before the resolver runs. Until then the handler's existing `!isController` gate silently no-ops for non-controllers, matching today's behavior.
- **Image preview / inline thumbnails via the iTerm2 image protocol.**
- **"Copy to my machine" download route for LAN deployments.**

## Testing

- `TerminalSlot.test.tsx` (extend): simulate both `paste` and `drop` events with synthetic payloads (text-only, file-only, mixed, zero-byte, oversized). Assert `preventDefault` is called only when we handle it, `writeInput` receives the escaped paths, and the toast key matches the failure mode. For drop, additionally assert `setDragOver(false)` fires regardless of resolution outcome (UI state must not get stuck).

  **Testability note.** jsdom does not implement `ClipboardEvent` (the constructor exists but `clipboardData` is unset) and `DataTransfer` is only a partial stub. Do not rely on constructing real events in jsdom — instead, factor the per-event logic into pure helpers and unit-test those, then keep the DOM wiring thin and verify it via a single Electron integration test (Playwright + Electron driver, or `@playwright/test` with `electron`/`_electron`). Concretely:
  - Extract `processPaste({ text, files }, backend) → Promise<PasteResolution>` and `processDrop({ files }, backend) → Promise<PasteResolution>` as pure functions in `web/clipboard/process.ts`. The slot handlers become one-liners that build the event-data argument and call the function. Unit-test the pure functions with synthetic `File` / string inputs (no DOM).
  - Cover the DOM wiring (capture-phase firing, `preventDefault` timing, `setDragOver(false)` placement, async-result toast mapping) in one Electron end-to-end test that exercises the real slot.

- `app-shell-client.test.ts` (extend): mock `getRendererBridge().saveClipboardFiles` for both runtimes; assert the resolver splits files into path-known vs. blob-only, concatenates results, and reports `failed` correctly when blob-save returns fewer paths than input. For web, mock the HTTP backend and assert the multipart payload (including the filename fallback for empty `file.name`).
- `clipboard-bridge.test.ts` (new, Electron): mock `os.tmpdir()`, assert files are written with timestamped names, oversized payloads are rejected, startup prune removes stale files.
- `clipboard-write-paths.test.ts` (new, server): same shape — Hono test app with a temp data dir. Assert: writes are timestamped, prune of stale files works, body-limit returns 413, auth returns 401, happy path returns absolute paths under the data dir.

## Rollout

1. Land the design doc and an empty `feat/terminal-paste-file` branch as this draft PR.
2. Implement in this order: shared constant → main process handler + server route → renderer resolver → slot paste handler → slot drop handler → mobile toolbar handler → i18n → tests.
3. Land the `app-factory.ts` body-limit refactor in the same PR (small, behavior-preserving, required for the 12 MiB cap).
4. Manual verification matrix:
   - **Electron drop**: drop a file from Finder/Explorer/Nautilus onto the terminal. Path appears in PTY. (Path-attempt step.)
   - **Electron paste**: copy a file in Finder/Explorer, focus the terminal, `Cmd+V`. Path appears. (Path-attempt step.)
   - **Electron paste (no path)**: copy an image from a browser tab, paste into terminal. Temp path appears. (Blob-save step.)
   - **Web drop**: drop a file from the OS file manager onto the web terminal (opened at `http://127.0.0.1:32100/`). Temp path appears. (Blob-save step via HTTP.)
   - **Web paste**: copy a file in the OS file manager, focus the web terminal, `Cmd+V`. Temp path appears. (Blob-save step via HTTP.)
   - **Linux mixed text+file**: copy a file in Nautilus, focus the terminal, `Ctrl+V`. Path appears, NOT the literal `file://` text string. (Confirms files-first ordering in §2 handler.)
   - Each of the four paths should also be exercised with an oversized file to confirm the `paste-file-too-large` toast and the `bodyLimit` 413 surface as documented.