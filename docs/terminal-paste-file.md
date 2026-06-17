# Terminal: paste file from clipboard

> **Status**: design draft, no implementation yet.
> Tracking PR: see the linked draft PR.

## Background

The terminal slot today has one mechanism for moving external content into the PTY: **drag-and-drop files** (`TerminalSlot.tsx` → `handleDrop`), which reads `event.dataTransfer.files`, calls `pathForDroppedFile` to resolve an absolute path through the Electron bridge, and writes the shell-escaped path(s) to the PTY.

There is no paste path at all today. Pressing `Cmd/Ctrl+V` inside the terminal goes straight to xterm.js, whose native paste handling is text-only — copying a file in Finder/Explorer and pasting gets you literally nothing (no echo, no toast, no error). The mobile toolbar (`mobile-terminal-toolbar.tsx`) exposes Esc / Tab / Ctrl+C / page-up / page-down and has no clipboard entry at all, so mobile has no paste affordance whatsoever, file or text. This PR adds the paste path on desktop and web; the mobile-toolbar paste button is out of scope (see Non-goals).

The web renderer (`serve.sh` / `scripts/start-server.ts`) has the same gap. Web drag-and-drop today is silently a no-op (`WEB_RENDERER_CAPABILITIES = []`, `pathForDroppedFile` returns `''`), and web paste is also silently a no-op for files. This PR closes both gaps on web by routing both drop and paste through the same `resolvePastedFiles` resolver backed by a new HTTP upload route.

## Goal

Make "paste file" work the same way "drop file" already does, on both Electron and web renderers. Stay within the existing terminal state model (controller / viewer / mirror) and the existing renderer-bridge / server-route surfaces. Mobile (toolbar paste button) is deferred to a follow-up — the toolbar doesn't have a paste entry today, so adding one is its own UX decision (placement, icon, accessible name) that doesn't need to land in the same PR as the desktop/web plumbing.

## Non-goals (first iteration)

- **Mobile toolbar paste button.** The mobile toolbar today is keys-only (Esc/Tab/Ctrl+C/scroll); there is no paste entry to extend. Adding one is a separate UX change (icon, accessible name, placement, focus rules) and is tracked as a follow-up. Desktop `Cmd/Ctrl+V` and web-browser paste are covered by this PR via the capture-phase slot listener in §2.
- **Remote (SSH) worktrees.** Out of scope for the first iteration — the codebase has no SSH terminal support yet, so there is no remote-controller case to surface. When SSH lands, the controller-attached-to-remote case must be detected (via `attachment.role` / `processName` / SSH plumbing — see `docs/terminal-target-model.md`) and a `terminal.paste-file-remote` toast introduced; tracked as a follow-up.
- **Files larger than a configurable cap** (proposed: 10 MiB, exposed as `PASTE_FILE_MAX_BYTES` in `src/shared/`). Pasting a 2 GB ISO into a shell prompt is rarely what the user wants; we refuse with a toast and suggest an external transfer (shell `scp`/`rsync`, file manager, or a real upload flow). Drag-and-drop is **not** suggested as an alternative — it shares the same cap and would be rejected for the same reason.
- **Image preview / inline thumbnails.** Even if xterm supports the iTerm2 image protocol, the minimum useful behavior is to write a path the user can open. Inline image support is a follow-up.
- **OS-clipboard path formats on Electron** (`clipboard.readBuffer('FileNameW')` / NSFilenamesPboard / `text/uri-list`). These formats would let the path-attempt step skip the blob upload in some cases, but the cross-platform implementation cost is high and `webUtils.getPathForFile` already covers the common case. See §"Follow-ups".

## User-facing behavior

After this PR, the terminal slot accepts file content through two gestures on both Electron and web:

|  | Electron app | Web (`serve.sh`) |
|---|---|---|
| **Drag-and-drop** | ✅ via `pathForDroppedFile` + IPC save | ✅ via HTTP upload (new) |
| **Paste (`Cmd/Ctrl+V`)** | ✅ via `pathForDroppedFile` + IPC save | ✅ via HTTP upload (new) |
| **Mobile toolbar paste button** | ❌ no toolbar entry exists today; deferred | ❌ same; deferred |

### Desktop (Electron)

1. User focuses the terminal and presses `Cmd+V` (macOS) or `Ctrl+V` (Linux/Windows).
2. If the clipboard contains file(s) — files win over text (see §2 handler and §9 "Linux text/uri-list mixed with text"):
   - For each file, ask the main process for its filesystem path via `webUtils.getPathForFile(file)`. Files with a path are written to the PTY as a shell-escaped space-separated list.
   - Files without a path (e.g. an image copied from a browser tab) are written to a temp dir under `<os.tmpdir>/goblin-clipboard-<pid>/` and their absolute paths are appended to the list.
   - If the PTY is a remote mirror (controller attached to a remote host), do not write anything. A future SSH iteration will surface a specific toast here; for now the handler's existing `!isController` gate silently no-ops, matching today's behavior for non-controllers.
   - If the resolution fails, show `terminal.paste-file-failed`.
3. If the clipboard contains only text (no files), xterm pastes it as today (no change).
4. Drag-and-drop continues to work as today — files dropped from Finder/Explorer or another app are passed through the same resolver, so a dropped image blob (no path) is also written to the temp dir and echoed.

### Mobile (deferred)

The mobile toolbar (`mobile-terminal-toolbar.tsx`) currently exposes Esc/Tab/Ctrl+C/page-up/page-down only — no clipboard entry — and is not extended in this PR. Mobile users still get the underlying browser paste via long-press → Paste on the xterm surface, which routes through this PR's capture-phase handler the same way desktop `Cmd+V` does, so files copied from the OS file manager will work where the platform exposes them through `ClipboardEvent`. A dedicated toolbar button (with its own icon, accessible name, and `navigator.clipboard.read()`-based file detection) is its own UX change and is tracked as a follow-up.

### Web renderer scope

The web renderer has zero native capabilities today (`WEB_RENDERER_CAPABILITIES = []`), so `webUtils.getPathForFile` is unavailable. The resolver collapses to:

1. **Path attempt** — `pathForDroppedFile(file)` returns `''` for every file. Falls through.
2. **Blob save** — upload each file via `POST /api/clipboard/files`. The server writes to `<serverDataDir()>/clipboard-tmp-<pid>/` and returns absolute paths the PTY can read.

Both **drop** and **paste** route through this same resolver on web, so the two gestures are symmetric: drop a file from Finder onto the web terminal and the server writes it to a temp path; copy a file in Finder and `Cmd+V` in the web terminal, same outcome.

Behavior contract on web:

- A `paste` event with at least one file uploads to the server, regardless of any `text/plain` presence (files-first ordering — see §9 "Linux text/uri-list mixed with text"). On success, paths are echoed into the PTY. On failure (server unreachable, batch exceeds `MAX_PASTE_BATCH_BYTES` at `bodyLimit`, server error), the user sees `terminal.paste-file-failed`. (Single-file oversize is intercepted earlier in the renderer with `paste-file-too-large`, not here.)
- A `drop` event with files uploads to the server. Same success / failure surface as paste. The existing `dragOver` indicator (the dashed border on the slot) is preserved unchanged.
- A `paste` event with text continues to flow through xterm as today; the resolver is not consulted.
- The paste and drop handlers' `isController` gate applies on web exactly as on desktop (viewers and mirrors silently no-op for files; text still flows through xterm for paste). Remote-host detection is deferred (see §"Follow-ups").
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
- Server (`createClipboardRoutes`): the `bodyLimit` middleware is per-batch, sized at `PASTE_FILE_MAX_BYTES + 2 MiB` (multipart overhead — call it `MAX_PASTE_BATCH_BYTES` for clarity at the route level). A multi-file batch where each file is under the cap but the sum exceeds the batch limit is rejected at the transport layer with a generic 413, mapping to `terminal.paste-file-failed` (not "too-large") in the UI.

Why the per-file check and the batch limit serve different audiences:

- **Renderer per-file check** = the user-friendly path. It produces `terminal.paste-file-too-large` *before* the request leaves the browser, so the user sees a specific, actionable toast (suggesting `scp`/`rsync` in the message body would be a natural follow-up).
- **Server `bodyLimit`** = worker protection. It defends against a hostile client that bypasses the renderer (custom curl, malicious extension, replayed request) from streaming arbitrary bytes into multipart parsing. The 413 it produces is intentionally generic because by that point we're past the UX layer.

There's one observable consequence of this split: a *single* 12+ MiB file from a bypassed-renderer request is caught only by `bodyLimit` (→ 413 → `paste-file-failed`), not by `paste-file-too-large`. The legitimate renderer code path can never reach that branch; it's just defense-in-depth.

### 2. Web: capture-phase paste on the slot

Add a capture-phase `paste` listener on the slot root in `TerminalSlot.tsx`, parallel to the existing `onDrop` handler. xterm renders *inside* the slot root (`TerminalSlot.tsx:265` → `terminal-session-view.ts:69-73` → xterm host), so a capture-phase handler on the root fires first by the standard DOM dispatch order — there's no need to call `stopPropagation()` to "beat" xterm, and `preventDefault()` alone is enough to suppress xterm's built-in paste. (Don't `stopPropagation`: it would silently break any future bubble-phase paste listener above the slot — toast region, focus tracker, error boundary.)

The slot already uses `onFocusCapture`/`onBlurCapture`/`onKeyDownCapture` (lines 242-244), so the same `on<Event>Capture` JSX prop works for paste — no `useEffect + addEventListener('paste', ..., true)` needed.

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
}, [key, isController, writeInput, t, toast])
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
   * Number of blobs the resolver handed to the backend that did not come back
   * with a path. Computed as `blobOnly.length - saved.length` — path-attempt
   * successes do not count, they're already in `paths`. Surfacing this prevents
   * silent partial loss: if `failed > 0 && paths.length > 0`, the handler shows
   * a `paste-file-partial` toast in addition to writing the paths that did
   * succeed.
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

  // Blob save: persist remaining blobs via the runtime backend.
  // The backend is all-or-nothing in the happy path (every input written,
  // every path returned) but can return fewer paths than blobOnly.length on
  // partial transport failure. We count the gap as `failed`.
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

- The preload converts each `File` to `{ name: string; bytes: ArrayBuffer }` via `arrayBuffer()` before invoking IPC, so the wire payload is plain structured-clone data. The main process does not call `arrayBuffer()`. We use `ArrayBuffer` instead of `Uint8Array` for documentation reasons, not performance — `ipcRenderer.invoke` uses HTML structured clone and exposes no `transfer` list ([Electron docs](https://www.electronjs.org/docs/latest/api/ipc-renderer); zero-copy needs `ipcRenderer.postMessage` with a transfer array), so both forms cost the same memcpy. `ArrayBuffer` just makes the IPC surface unambiguous about what's on the wire.
- Rejects if any single file's `bytes.byteLength` exceeds `PASTE_FILE_MAX_BYTES` (defense-in-depth; the renderer-side check should already have caught it).
- Writes under `<os.tmpdir>/goblin-clipboard-<pid>/` with timestamped names (`<ISO-timestamp>-<index>-<basename>`).
- On startup, prune the temp dir of files older than the previous run. This is a one-shot cleanup per process, not per-request — simpler and more correct than per-request pruning.
- Returns absolute paths.

### 5. New HTTP surface (web)

Add a single route to the server under `/api/clipboard/files`, parallel to the existing `/api/settings`, `/api/repo`, `/api/remote` mounts:

```
POST /api/clipboard/files
  Headers: x-goblin-access-token: <accessToken>      // embedded renderer / dev mode
            Cookie:    goblin_access_token=<token>    // browser, http-only
  Body:    multipart/form-data
             files: <binary blobs, repeated>
  200 OK:  { paths: string[] }                        // bare business object, matching settings/repo/remote conventions
  4xx/5xx: { ok: false, code, message }               // errorJson envelope from src/server/common/responses.ts
```

The success-shape convention here is "bare business object via `c.json(...)`", not `{ ok: true, data: ... }` — that matches the existing routes (`src/server/routes/settings.ts:26`, `src/server/routes/remote.ts:15-42`, etc.). Errors flow through `errorJson(c, code, message)` (`src/server/common/responses.ts:34-41`), which produces the `{ ok: false, code, message }` envelope with the HTTP status mapped from `HTTP_STATUS_BY_IPC_CODE`.

Concretely:

- New factory `createClipboardRoutes()` under `src/server/routes/clipboard.ts`, mounted in `app-factory.ts`. The mount point is `/api/clipboard`, which means the existing `cors` and `applyApiSecurityHeaders` middlewares (registered for `/api/*` in `app-factory.ts`) cover the new route automatically. **Auth is not** auto-applied: `createAccessTokenMiddleware` is only registered on `/api/settings/*`, `/api/repo/*`, `/api/remote/*`. Add an explicit `app.use('/api/clipboard/*', createAccessTokenMiddleware(options.accessToken))` in `app-factory.ts` next to the existing auth registrations, before mounting the new routes.
- Per `docs/layering.md`, the route file is thin — it parses the multipart body, calls into the write layer, and returns the JSON envelope. Orchestration lives in a new `src/server/modules/clipboard-write-paths.ts` module, parallel to `settings-write-paths.ts` and `repo-write-paths.ts`.
- **Body limit refactor**. The existing `bodyLimit({ maxSize: 1 MiB })` middleware on `/api/*` (`app-factory.ts:131-137`) is too tight for 10 MiB blobs (multipart overhead included), and a per-route override registered *after* the global one does not take effect — Hono's `bodyLimit` reads `Content-Length` and returns `onError(c)` directly when it exceeds `maxSize` *before* calling `next()` (see `node_modules/hono/dist/middleware/body-limit/index.js:18-21`), so any later middleware in the chain never runs. The fix is to delete the global `/api/*` `bodyLimit` and register one per sub-path that needs it.

  The new ordering on each protected sub-path (`/api/settings/*`, `/api/repo/*`, `/api/remote/*`, `/api/clipboard/*`) is:

  ```
  cors → applyApiSecurityHeaders → auth → bodyLimit → route
  ```

  Two things to get right:

  1. **bodyLimit goes after auth, not before.** If `bodyLimit` runs first, an unauthenticated client sending a 100 GB body gets a 413 instead of a 401, which (a) wastes the server's bandwidth measuring a request it would reject anyway and (b) leaks the existence of size limits to unauthenticated probes. Auth-first short-circuits both. The renderer can never observe this difference because it always sends the secret header.
  2. **`/api/health` loses its bodyLimit.** Today the global `/api/*` rule covers health endpoints by accident. Health handlers don't accept bodies but they do accept POSTs in principle, and they're frequently hit by external probes. Add an explicit `app.use('/api/health/*', bodyLimit({ maxSize: 1 KiB, onError: ... }))` so the new layout doesn't accidentally widen the attack surface — a kilobyte is generous for any health request that legitimately exists.

  The four protected routes keep the existing 1 MiB cap; only `/api/clipboard/*` gets `MAX_PASTE_BATCH_BYTES`. Behavior for every existing endpoint is preserved (same 413 on overflow, same status codes), and the refactor must land in the same PR as the new route.
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
        headers: { 'x-goblin-access-token': config.accessToken },
        body: form,
      })
      if (!res.ok) return []
      const json = await res.json() as { paths?: string[] }
      return Array.isArray(json.paths) ? json.paths : []
    },
  }
}
```

The bootstrap snapshot already carries `initialServer.url` and `initialServer.secret` (see `buildWebBootstrap` in `app-factory.ts`), so the backend has no new wiring. Construct it inside `webBridge()` in `src/web/renderer-bridge.ts`, parallel to the existing `createServerTerminalBridge` call, and return it as the `saveClipboardFiles` implementation of the web `RendererBridge`.

### 6. Mobile toolbar paste button (deferred)

Out of scope. The mobile toolbar (`mobile-terminal-toolbar.tsx`) has no paste entry today, and adding one is a UX decision in its own right — icon, placement next to Ctrl+C, accessible name, focus rules, and a `navigator.clipboard.read()` fallback chain when the document is unfocused or permission is denied. Tracked as a follow-up (§"Follow-ups"). Mobile users still get the underlying browser paste via long-press → Paste on the xterm surface, which goes through the same capture-phase handler from §2.

### 7. Drag-and-drop on the slot

The existing `handleDrop` in `TerminalSlot.tsx:190` only calls `pathForDroppedFile`, which returns `''` on web — making drag-and-drop a silent no-op there. The fix is to route the file list through `resolvePastedFiles`, the same resolver paste uses. On Electron the path-attempt step still wins for filesystem files (the fast path is unchanged); on web it always falls through to the blob-save step. One function, two runtimes, identical UX.

This PR also tightens the drop gate to match paste: drop now checks `isController`, not just `!key`. Today's drop handler accepts any slot with a `key`, which means a viewer can drop a file into a session it doesn't own — the PTY write either silently disappears (server rejects non-controller input) or echoes into the controller's session, depending on the route. Both outcomes are wrong. Symmetrizing now costs one extra `&& isController` and avoids the kind of paste/drop asymmetry that becomes folklore over time.

```ts
const handleDrop = useCallback(
  (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setDragOver(false)
    if (!key || !isController) return       // controller-only, same as paste
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
  [key, isController, writeInput, t, toast],
)
```

Notes:

- The existing `setDragOver(false)` UI side-effect is preserved.
- `!isController` no-ops silently (no toast). This matches the paste handler's contract for non-controllers: dropping into a viewer is rare enough that a toast would be more noise than signal; if telemetry shows it actually happens, we can add a toast later.
- Size enforcement and toast surface are identical to the paste handler — same i18n keys, same threshold.

### 8. i18n

New keys (en/zh/ja/ko), following the existing flat `terminal.<kebab>` convention. The keys are named after the **gesture** (paste), but the drop handler reuses them on purpose: a "file too large" toast is the same UX regardless of whether the user pasted or dropped. If the team wants gesture-specific copy, split later.

- `terminal.paste-file-failed` — resolver returned no paths
- `terminal.paste-file-partial` — some files resolved, some didn't (only shown when `failed > 0 && paths.length > 0`)
- `terminal.paste-file-too-large` — file exceeded the configured size cap

### 9. Error handling and edge cases

- **Viewer / mirror mode**: both `handlePasteCapture` and `handleDrop` short-circuit when `!isController`, silently no-opping for files. Text paste still flows through xterm for viewers (xterm's own paste isn't gated). The handlers are symmetric on this point — see §7 for the rationale on tightening drop's gate.
- **Remote host**: deferred to follow-up (see §"Follow-ups"). The first iteration has no SSH, so there is no remote-controller case to handle. The existing `!isController` gate in the paste handler covers non-controllers (viewers, mirrors, unowned) by silently no-opping for files — this is the current behavior, preserved unchanged.
- **Size cap**: enforced at three layers, all reading `PASTE_FILE_MAX_BYTES` — renderer handlers (paste + drop, early bail with toast), the main-process IPC handler (defense-in-depth; rejects oversized payloads before reading bytes), and the server `bodyLimit` middleware (transport ceiling; per-batch, sized at `PASTE_FILE_MAX_BYTES + 2 MiB`). The server route handler itself does **not** re-check per-file size — the bodyLimit already bounds the request, and the renderer is the only legitimate source of paste/drop events, so adding a redundant check would be code without a purpose. Per-file intent is enforced at the renderer; per-batch transport safety is enforced at the bodyLimit.
- **Zero-byte files**: `collectClipboardFiles` filters them out. If filtering drops everything, the function returns and we do not `preventDefault`, so the user keeps their usual paste experience.
- **No file selected, only image**: still a file-like blob; we serialize it like any other binary and write the path. xterm will not preview it, but the user can open it.
- **Server unreachable (web only)**: the HTTP backend returns `[]` on network error, which maps to `terminal.paste-file-failed`. No silent failure.
- **Startup cleanup of stale temp files**: a single pruning pass on main / server startup. If the process crashes mid-write, leftover files from the previous run are removed on next boot. Per-request pruning is unnecessary.
- **Linux `text/uri-list` mixed with text**: when a file manager copies a file on Linux, the clipboard carries `text/uri-list` *and* `text/plain` (a textual rendering of the same URI list). The capture handler must check for files (`data.files` / `data.items` with `kind === 'file'`) **before** the text/plain bail-out — otherwise a Linux file copy is pasted as a literal `file:///home/user/foo.png` string. The handler ordering in §2 already does this (file check precedes text check); the helper `collectClipboardFiles` returns the file blobs, and the text fallback only fires when no files are present.

## Follow-ups (not in this PR)

- **Mobile toolbar paste button.** Add a dedicated entry to `mobile-terminal-toolbar.tsx` (icon, accessible name, placement next to Ctrl+C) that reads `navigator.clipboard.read()` and dispatches on `clipboardItem.types`: files → `resolvePastedFiles`, text-only → `readText`, neither → no-op. Wrap in `try/catch` and fall back to `readText` on `NotAllowedError` / API unavailable.
- **OS-clipboard path formats on Electron.** `clipboard.readBuffer('FileNameW')` (Windows), NSFilenamesPboard (macOS), `text/uri-list` (Linux). When implemented, this would slot into the resolver as a *prepended* step before the current path-attempt: try `clipboard.readBuffer` first, fall through to `webUtils.getPathForFile` + blob save. Cross-platform cost is high; defer.
- **Remote-host detection.** When SSH terminal support lands, the controller-attached-to-remote case needs detection (via `attachment.role` / `processName` / SSH plumbing — see `docs/terminal-target-model.md`) and a new `terminal.paste-file-remote` toast surfaced from the paste handler before the resolver runs. Until then the handler's existing `!isController` gate silently no-ops for non-controllers, matching today's behavior.
- **Image preview / inline thumbnails via the iTerm2 image protocol.**
- **"Copy to my machine" download route for LAN deployments.**

## Testing

- `TerminalSlot.test.tsx` (extend): simulate both `paste` and `drop` events with synthetic payloads (text-only, file-only, zero-byte, oversized). Assert `preventDefault` is called only when we handle it, `writeInput` receives the escaped paths, and the toast key matches the failure mode. For drop, additionally assert `setDragOver(false)` fires regardless of resolution outcome (UI state must not get stuck). **The Linux mixed `text/uri-list`+`text/plain` case is *not* covered here** — jsdom can't faithfully deliver a dual-format `ClipboardEvent`; it lives in the Rollout manual matrix and the Electron e2e instead.

  **Testability note.** jsdom does not implement `ClipboardEvent` (the constructor exists but `clipboardData` is unset) and `DataTransfer` is only a partial stub. Do not rely on constructing real events in jsdom — instead, factor the per-event logic into pure helpers and unit-test those, then keep the DOM wiring thin and verify it via a single Electron integration test (Playwright + Electron driver, or `@playwright/test` with `electron`/`_electron`). Concretely:
  - Extract `processPaste({ text, files }, backend) → Promise<PasteResolution>` and `processDrop({ files }, backend) → Promise<PasteResolution>` as pure functions in `web/clipboard/process.ts`. The slot handlers become one-liners that build the event-data argument and call the function. Unit-test the pure functions with synthetic `File` / string inputs (no DOM).
  - Cover the DOM wiring (capture-phase firing, `preventDefault` timing, `setDragOver(false)` placement, async-result toast mapping, **and the Linux mixed payload case**) in one Electron end-to-end test that exercises the real slot.

- `app-shell-client.test.ts` (extend): mock `getRendererBridge().saveClipboardFiles` for both runtimes; assert the resolver splits files into path-known vs. blob-only, concatenates results, and reports `failed` correctly when blob-save returns fewer paths than input. For web, mock the HTTP backend and assert the multipart payload (including the filename fallback for empty `file.name`).
- `src/main/clipboard-bridge.test.ts` (new): follow the existing main-process test pattern (`vi.mock('electron', () => ({...}))`, `vi.hoisted` for handles, no real Electron binary) — see `src/main/ipc.test.ts` for the template. Mock `os.tmpdir()`, assert files are written with timestamped names, oversized payloads are rejected, startup prune removes stale files.
- `src/server/modules/clipboard-write-paths.test.ts` (new): same shape as `settings-write-paths.test.ts` — Hono test app with a temp data dir. Assert: writes are timestamped, prune of stale files works, body-limit returns 413, auth returns 401, happy path returns absolute paths under the data dir.

## Rollout

1. Land the design doc and an empty `feat/terminal-paste-file` branch as this draft PR.
2. Implement in this order: shared constant → main process handler + server route → renderer resolver → slot paste handler → slot drop handler → mobile toolbar handler → i18n → tests.
3. Land the `app-factory.ts` body-limit refactor in the same PR (small, behavior-preserving, required to lift the cap above 1 MiB for `/api/clipboard/*` without widening the cap globally).
4. Manual verification matrix:
   - **Electron drop**: drop a file from Finder/Explorer/Nautilus onto the terminal. Path appears in PTY. (Path-attempt step.)
   - **Electron paste**: copy a file in Finder/Explorer, focus the terminal, `Cmd+V`. Path appears. (Path-attempt step.)
   - **Electron paste (no path)**: copy an image from a browser tab, paste into terminal. Temp path appears. (Blob-save step.)
   - **Web drop**: drop a file from the OS file manager onto the web terminal (opened at `http://127.0.0.1:32100/`). Temp path appears. (Blob-save step via HTTP.)
   - **Web paste**: copy a file in the OS file manager, focus the web terminal, `Cmd+V`. Temp path appears. (Blob-save step via HTTP.)
   - **Linux mixed text+file**: copy a file in Nautilus, focus the terminal, `Ctrl+V`. Path appears, NOT the literal `file://` text string. (Confirms files-first ordering in §2 handler.)
   - Each of the four paths should also be exercised with an oversized file to confirm the `paste-file-too-large` toast and the `bodyLimit` 413 surface as documented.