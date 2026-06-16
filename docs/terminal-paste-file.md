# Terminal: paste file from clipboard

> **Status**: design draft, no implementation yet.
> Tracking PR: see the linked draft PR.

## Background

The terminal slot today has two disjoint mechanisms for moving external content into the PTY:

- **Drag-and-drop files** (`TerminalSlot.tsx` → `handleDrop`): reads `event.dataTransfer.files`, calls `pathForDroppedFile` to resolve an absolute path through the Electron bridge, and writes the shell-escaped path(s) to the PTY.
- **Clipboard text** (mobile toolbar `Paste` button → `handleToolbarPaste`): uses `navigator.clipboard.readText()` and writes the result.

Neither path handles the common case where a user copies a file in Finder/Explorer and presses `Cmd/Ctrl+V` (desktop) or taps the `Paste` button (mobile) inside the terminal. `navigator.clipboard.readText()` returns an empty string for non-text clipboard content, and xterm.js' native paste handling has no file semantics, so the user sees nothing happen with no error feedback.

## Goal

Make "paste file" work the same way "drop file" already does, in both desktop and mobile flows, while staying within the existing terminal state model (controller / viewer / mirror) and renderer-bridge surface.

## Non-goals (first iteration)

- **Remote (SSH) worktrees.** Out of scope. The clipboard path is resolved on the local machine; the resulting path only makes sense if the PTY is running on the same filesystem. We will surface a clear error when the active terminal is a mirror to a remote host.
- **Files larger than a configurable limit** (proposed default: 10 MiB). Pasting a 2 GB ISO into a shell prompt is rarely what the user wants; we should refuse with a toast and suggest drag-and-drop or a real upload flow.
- **Image preview / inline thumbnails.** Even if xterm supports the iTerm2 image protocol, the minimum useful behavior is to write a path the user can open. Inline image support is a follow-up.
- **Custom MIME types from other Goblin panes** (`GOBLIN_FILE_PATHS_MIME`-style). The drag-and-drop path can keep that as a private optimization; the clipboard path is the new public one.

## User-facing behavior

### Desktop

1. User focuses the terminal and presses `Cmd+V` (macOS) or `Ctrl+V` (Linux/Windows).
2. If the clipboard contains text, xterm pastes it as today (no change).
3. If the clipboard contains file(s):
   - Best effort: write a shell-escaped space-separated list of absolute paths to the PTY.
   - If the PTY is a remote mirror, show a toast: `terminal.paste-file-remote` and do not write anything.
   - If the resolution fails (e.g. native bridge missing, all files exceed the size limit), show a toast: `terminal.paste-file-failed`.

### Mobile (existing toolbar `Paste` button)

1. The button currently calls `navigator.clipboard.readText()`. After this change, the button should:
   - Try `navigator.clipboard.read()` first to detect image / file blobs.
   - If files are present, route them through the same resolver as the desktop path.
   - If only text is present, keep the current `readText()` behavior.
2. UX contract: a successful file paste produces a visible result (paths echoed into the PTY) and a successful text paste produces its text — never silently nothing.

## Implementation

### 1. Web: intercept `paste` on the slot

Add a capture-phase `paste` listener on the slot root in `TerminalSlot.tsx`, parallel to the existing `onDrop` handler. xterm receives its own copy because capture-phase handlers run before the event reaches xterm's DOM, and we only call `preventDefault()` when we actually handle it.

```ts
const handlePasteCapture = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
  if (!key || !isController) return                       // viewer / mirror: do nothing
  if (isExternalInputPasteTarget(event.target, ...)) return // external input has its own handler
  if (event.clipboardData.getData('text/plain').length > 0) return // text → let xterm handle it

  const files = binaryPasteFiles(event.clipboardData)     // DataTransfer.files / items
  if (files.length === 0) return                          // nothing useful to do, do not preventDefault

  event.preventDefault()
  event.stopPropagation()
  void resolvePastedFiles(files).then((paths) => {
    if (paths.length === 0) {
      toast.error(t('terminal.paste-file-failed'))
      return
    }
    writeInput(key, paths.map(shellEscapePath).join(' '))
  })
}, [...])
```

`binaryPasteFiles(data)` mirrors hobgoblin: prefer `data.files`, fall back to `data.items` (`kind === 'file'` → `getAsFile()`), and filter out zero-byte entries that some platforms emit as placeholders.

### 2. Web: three-tier path resolver

```ts
async function resolvePastedFiles(files: File[]): Promise<string[]> {
  // 1. OS-level file paths (Finder/Explorer copies). Requires a new IPC.
  const systemPaths = await readSystemClipboardFilePaths()
  if (systemPaths.length > 0) return systemPaths

  // 2. Per-file pathForFile via the existing IPC. Returns '' when Electron cannot
  //    resolve a path (e.g. some image blobs from a browser source).
  const bridged = files
    .map((file) => pathForDroppedFile(file))
    .filter((path) => path.length > 0)
  if (bridged.length > 0) return bridged

  // 3. Fallback: serialize blobs to a temp directory via a new IPC.
  const payload = await Promise.all(files.map(fileToClipboardPayload))
  const result = await saveClipboardBinaryFilesFromPaste(payload)
  return result.ok ? result.paths : []
}
```

### 3. New IPC surface (preload + main)

Extend `src/web/renderer-bridge-types.ts` and the implementations in `src/web/renderer-bridge.ts` and the main process.

```ts
// renderer-bridge-types.ts (additions)
readClipboardFilePaths(): Promise<string[]>
saveClipboardBinaryFiles(input: SaveClipboardBinaryFilesInput): Promise<SaveClipboardBinaryFilesResult>

interface SaveClipboardBinaryFilesInput {
  worktreePath: string
  temporaryFilesDirectory: string
  files: Array<{ name: string; bytesB64: string }>
}
interface SaveClipboardBinaryFilesResult {
  ok: boolean
  paths?: string[]
  message?: string  // i18n key
}
```

Main process responsibilities:

- `readClipboardFilePaths()` calls Electron's `clipboard.readBuffer('FileNameW')` / NSFilenamesPboard-style APIs. Return an empty array on platforms where this is unsupported; the resolver then falls through to the next tier.
- `saveClipboardBinaryFiles(input)` writes files under a per-process temp directory (`<os.tmpdir>/goblin-clipboard-<pid>`) with timestamped names, deletes files older than the previous run, and returns the absolute paths. The renderer must pass the resolved `temporaryFilesDirectory` from the bootstrap, not invent a path of its own (this is a renderer-no-filesystem rule already enforced by `arch.md`).

### 4. Mobile toolbar `Paste` button

Replace the body of `handleToolbarPaste` in `TerminalSlot.tsx` to try `navigator.clipboard.read()` first and dispatch on `clipboardItem.types`:

- includes `text/plain` → existing text behavior
- includes any `image/*` or matches file-shaped MIME → call `resolvePastedFiles` with the resulting `Blob` array

If `navigator.clipboard.read` is unavailable, keep the existing `readText` fallback for text. Do not pretend to support files we cannot see.

### 5. i18n

New keys (en/zh/ja/ko):

- `terminal.paste-file-failed` — resolver returned no paths
- `terminal.paste-file-remote` — controller is attached to a remote host
- `terminal.paste-file-too-large` — file exceeded the configured size cap
- `terminal.paste-file-empty` — clipboard had no usable text or file content

### 6. Error handling and edge cases

- **Viewer / mirror mode**: `handlePasteCapture` returns early; the xterm paste (text) still works for viewers, but file paste requires controller authority, matching the drag-and-drop rule.
- **Remote host**: detect via the existing `attachment.role` / `processName` / SSH plumbing; if remote, toast and bail.
- **Size cap**: check `file.size` in the renderer before serializing; bail early with a typed result so the toast uses the right key.
- **Zero-byte files**: `binaryPasteFiles` already filters them out. If filtering drops everything, the function returns and we do not `preventDefault`, so the user keeps their usual paste experience.
- **No file selected, only image**: still a file-like blob; we serialize it like any other binary and write the path. xterm will not preview it, but the user can open it.

### 7. Testing

- `TerminalSlot.test.tsx` (extend): simulate `paste` events with synthetic `ClipboardEvent` payloads (text-only, file-only, mixed, zero-byte, oversized).
- `app-shell-client.test.ts` (extend): mock `readClipboardFilePaths` and `saveClipboardBinaryFiles` and assert the resolver falls through tiers in the documented order.
- New unit test for the main-process handler that the temp directory is created under `os.tmpdir()`, names are timestamped, and stale files from previous runs are pruned.

## Rollout

1. Land the design doc and an empty `feat/terminal-paste-file` branch as this draft PR.
2. Implement in this order: IPC types → main process → renderer resolver → slot handler → mobile toolbar handler → i18n → tests.
3. Manual verification on macOS (Finder file copy) and Linux (Nautilus / `xclip` with `text/uri-list`) before marking the PR ready for review.
4. Remote-host detection can ship as a stub (`return []` for now) and be filled in once the SSH terminal state is wired through `terminal-target-model.md`.
