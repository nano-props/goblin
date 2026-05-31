# Terminal Spike Decision

## Native renderer evaluated first

Phase 1 evaluates a native Compose renderer before any WebView/xterm fallback. The selected spike uses a Compose text viewport, monospace styling, scroll containers, a text input row, and a compact helper-key row. This is intentionally smaller than a full terminal emulator; its job is to prove Android SSH shell streaming, input, paste, resize, and cleanup.

## Selected renderer

Selected renderer: Compose native text viewport.

The renderer is enough for Phase 1 because it:

- Streams SSH shell output into a scrollable viewport.
- Sends typed input through `TerminalController.sendInput`.
- Supports paste through the Android clipboard.
- Observes layout changes and calls the terminal resize path.
- Keeps all output runtime-only.

## Fallback criteria

WebView/xterm is fallback only after documented native failure.

Fallback is allowed later if the native renderer cannot support expected terminal behavior such as ANSI rendering, alternate screen applications, reliable modifier keys, or performance with large output. Phase 1 does not introduce WebView because native input/output/scroll/paste can be proven without it.

## Resize verification

The terminal screen observes layout dimensions through Compose constraints. It converts the visible size to approximate terminal columns and rows, then calls `TerminalController.resize`. The controller transitions through `Resizing` before returning to `Connected`.

Manual verification should include at least one orientation, soft keyboard, or layout-size change while connected.

## Replay buffer design

Replay buffer design is deferred to Phase 3 implementation but constrained now:

- Buffers are runtime-only and associated with host/session owner identity.
- The buffer has a strict character cap and drops oldest output when capped.
- Terminal output is not persisted in `HostProfileStore`, identity storage, or host-key storage.
- Reconnect/replay behavior should be visible to the user and must not silently resurrect closed sessions.
- A future worktree terminal should scope replay by host id, remote repository id, worktree path, and terminal session id.

## Deferred Phase 3 work

- Full terminal emulator behavior.
- ANSI color and alternate screen handling.
- Worktree-scoped terminal ownership.
- Replay buffer implementation and restore UI.
- Full helper-key behavior for complex modifier combinations.

