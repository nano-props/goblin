# Android SSH Terminal Emulator Design

## Summary

Goblin Android should replace the current text-only SSH terminal viewport with a real terminal emulator view for remote SSH PTY sessions.

The MVP should make remote interactive terminal programs usable, especially `vim` and `codex ai`, without adding Android-local shell support or embedding the Termux app runtime.

## Goals

- Use a real Android terminal emulator engine for remote SSH PTY display and input.
- Make `vim` usable over SSH for open, insert, edit, Esc, `:wq`, and save/exit.
- Make `codex ai` usable over SSH for dynamic screen refresh, prompt input, direction/selection keys, and confirmation.
- Keep Goblin's existing SSH identity, host-key trust, repository/worktree path, terminal session records, reconnect, close, and foreground bridge semantics.
- Preserve remote workspace terminal ownership: a terminal session still belongs to a host/repository/path record managed by Goblin.
- Pin any new dependency versions exactly.

## Non-goals

- Do not require the user to install the Termux app.
- Do not embed or launch the Termux app runtime.
- Do not add Android-local shell support.
- Do not add Termux package management.
- Do not access `/data/data/com.termux`.
- Do not route SSH through Termux.
- Do not implement mouse mode in the MVP.
- Do not implement complex copy/paste, sixel, graphics, or image protocols in the MVP.
- Do not replace Goblin's terminal session persistence or SSH lifecycle model.

## Current State

The current Android terminal path already has the remote SSH PTY and session management pieces:

- `SshTerminalService` opens SSHJ sessions, allocates an `xterm-256color` PTY, starts a shell, writes the initial `cd`, reads output, writes input, and resizes the remote window.
- `TerminalController` owns one active shell connection, keeps output snapshots, handles close/failure, and exposes `sendInput()` and `resize()`.
- `TerminalSessionManager` owns terminal records, controller mapping, reconnect, restore, close/delete, foreground state, and persisted snapshots.
- `TerminalScreen` owns route-level UI, toolbar actions, session switching, helper keys, line input, resize estimation, and close/reconnect.

The current display layer is not a terminal emulator:

- SSH output is filtered through `TerminalOutputFilter`.
- Filtered output is appended to a plain string.
- `TerminalViewport` renders that string with Compose `Text`.
- Input is mainly a single-line `BasicTextField` submitted as a line, plus helper buttons for a small set of control keys.

This is enough for simple line-oriented commands such as `pwd`, `ls`, and `git status`. It is not enough for full-screen TUI programs such as `vim`, `less`, `top`, `htop`, or `codex ai`.

## Selected Approach

Use Termux terminal libraries selectively, but do not directly embed Termux `TerminalView` as the remote SSH view.

The corrected approach is:

- Use `terminal-emulator` as the terminal parser, screen buffer, cursor state, alternate-screen handler, resize model, and xterm key mode source.
- Use `terminal-view` only if needed for reusable rendering/key helper classes such as `TerminalRenderer`; do not call `TerminalView.attachSession()`.
- Keep Goblin's SSHJ session as the only process/session runtime.
- Add a Goblin-owned Android terminal view that renders a Termux `TerminalEmulator` and sends terminal input back to Goblin's SSH controller.
- Add raw byte input/output paths so the emulator sees escape sequences exactly as the remote PTY emits them.

This preserves the user's intended scope: no Termux app install, no embedded Termux runtime, no Android-local shell, and no Termux package management.

## Termux API Fit Correction

The original "directly use `terminal-view`" design is rejected after API review.

The relevant API shape is:

- `TerminalView` is documented in source as a view for a `TerminalSession`.
- `TerminalView.attachSession(TerminalSession)` stores a `TerminalSession` and calls `updateSize()`.
- `TerminalSession` is a local subprocess model. Its source describes a process coupled to a terminal interface, and `initializeEmulator()` calls `JNI.createSubprocess(...)`.

That means using Termux `TerminalView` directly would pull Goblin toward Termux's local process lifecycle, which conflicts with the product requirement that Goblin owns a remote SSH PTY session.

The viable Termux API shape is:

- `TerminalEmulator` can be constructed directly with a `TerminalOutput`.
- Remote SSH output bytes can be fed into `TerminalEmulator.append(byteArray, length)`.
- `TerminalEmulator.resize(...)` updates emulator screen geometry.
- `KeyHandler.getCode(...)` can generate terminal key escape sequences using cursor/keypad application modes from the emulator.
- `TerminalRenderer.render(...)` can render a `TerminalEmulator` onto a Canvas if `terminal-view` is included for this helper class.

## Dependency And License Gate

Implementation must pass a dependency and license gate before production code integration:

1. Verify JitPack resolution for Termux artifact version `0.118.0` before production code integration.
2. If version `0.118.0` cannot be resolved, stop and revisit the design before adding any Termux dependency.
3. Pin the selected version exactly in `android/gradle/libs.versions.toml`; do not use `master-SNAPSHOT`, ranges, dynamic versions, or version aliases with range prefixes.
4. Import `com.termux.termux-app:terminal-emulator:0.118.0`.
5. Import `com.termux.termux-app:terminal-view:0.118.0` only if Goblin uses `TerminalRenderer` or another reviewed helper class from that artifact.
6. Do not import `termux-shared`.
7. Do not instantiate `TerminalSession`.
8. Do not call Termux JNI subprocess APIs.
9. Do not copy Termux app runtime code into Goblin.
10. If the selected dependencies package JNI libraries that are only needed for local subprocess support, exclude those files only after verifying Goblin does not call the classes that require them.
11. Record selected artifact coordinates, source links, and effective license notes in the implementation plan.

Termux's repository-level license is GPLv3-only, with documented exceptions for Terminal Emulator for Android code used by `terminal-view` and `terminal-emulator`. The implementation plan must verify the effective license for the exact artifacts before adding them.

## Architecture

### Existing Ownership Kept

Goblin remains responsible for:

- `SshHostProfile` and identity resolution.
- Host key trust evaluation.
- `RemoteTarget` construction.
- Repository/worktree terminal path semantics.
- `TerminalSessionRecord` persistence.
- Terminal reconnect, close, delete, and restore.
- Foreground/background terminal lifecycle.
- SSHJ shell creation, remote PTY allocation, remote input writes, remote output reads, and remote resize.

Termux terminal libraries are responsible for:

- Parsing terminal escape/control sequences.
- Maintaining the terminal screen buffer.
- Tracking cursor state, colors, alternate screen, wrapping, scrollback, and terminal modes.
- Translating terminal-specific key codes where the public helper API supports it.
- Rendering the terminal grid only through reviewed helper classes, not by owning the session.

### New Units

Add bridge units around Termux APIs rather than placing them directly in `TerminalScreen`.

#### `RemoteTerminalOutput`

Goblin implementation of Termux `TerminalOutput`.

Responsibilities:

- Receive emulator-generated bytes from terminal input, key events, or paste handling.
- Forward those bytes to `TerminalSessionManager.sendInputBytes(sessionId, bytes)`.
- Report title changes, bell, color changes, copy, and paste callbacks to small Goblin callbacks.
- Refuse writes after detach so stale input cannot reach an old session.

Non-responsibilities:

- It does not own SSHJ.
- It does not create local processes.
- It does not persist terminal records.

#### `RemoteTerminalEmulatorController`

Per Goblin terminal session adapter around Termux `TerminalEmulator`.

Responsibilities:

- Own one `TerminalEmulator` per active Goblin terminal session.
- Feed raw SSH output bytes into `TerminalEmulator.append(...)`.
- Keep the emulator buffer alive while `TerminalScreen` detaches or switches sessions.
- Resize the emulator before calling Goblin's remote resize path.
- Notify attached views when the emulator screen changes.
- Expose read-only access to the emulator for rendering.
- Expose current visible text for fallback diagnostics; persisted plain-text snapshots remain controller-owned.

Non-responsibilities:

- It does not open SSH sessions.
- It does not decide reconnect/close/delete policy.
- It does not render UI controls.

#### `GoblinTerminalView`

Goblin-owned native Android `View` wrapped from Compose with `AndroidView`.

Responsibilities:

- Render the active `TerminalEmulator` onto Canvas, using Termux `TerminalRenderer` if it passes the dependency gate.
- Measure monospace cell width and height.
- Calculate cols/rows from actual view size and font metrics.
- Request focus and expose terminal-friendly IME behavior.
- Translate software keyboard text, hardware keys, Esc, Tab, Enter, arrows, Backspace, Ctrl combinations, and paste into terminal input bytes.
- Invalidate on emulator screen updates.
- Surface renderer or emulator initialization failures as local UI state.

Non-responsibilities:

- It does not own terminal records.
- It does not own SSH connection state.
- It does not start or kill any process.

#### `TerminalController`

Existing SSH controller, extended for raw terminal transport.

Responsibilities retained:

- Open SSHJ shell sessions.
- Allocate the remote `xterm-256color` PTY.
- Close and fail the SSH session.
- Maintain bounded plain-text snapshots for persisted records and fallback UI.

New responsibilities:

- Read SSH output as raw bytes before any UTF-8 conversion.
- Emit raw output frames to `RemoteTerminalEmulatorController`.
- Keep using `TerminalOutputFilter` only for plain-text snapshots and fallback display.
- Write raw input bytes to the SSH shell output stream.

#### `TerminalSessionManager`

Existing session owner, extended as the coordination boundary.

Responsibilities retained:

- Create, attach, reconnect, close, delete, observe, and persist terminal records.
- Keep foreground service state based on terminal session state.

New responsibilities:

- Own or route to a `RemoteTerminalEmulatorController` for each running session.
- Expose an observe/detach API for `TerminalScreen` to bind the active view to the selected session's emulator.
- Expose `sendInputBytes(sessionId, bytes)` for terminal-native input.
- Preserve existing `sendInput(sessionId, value)` as a compatibility wrapper for helper buttons and tests.

#### `TerminalScreen`

`TerminalScreen` remains the route and lifecycle surface.

Responsibilities retained:

- Select active session.
- Connect/reconnect.
- Close after confirmation.
- Show toolbar and session status.
- Synchronize foreground bridge state.
- Switch between workspace sessions.

Responsibilities removed from the primary terminal path:

- Rendering main terminal output with Compose `Text`.
- Estimating terminal cols/rows using `maxWidth / 8f` and `maxHeight / 18f`.
- Using the line input field as the primary input mechanism.

The helper key row may remain as a phone ergonomics layer, but it sends terminal bytes into the same raw input path as the native terminal view.

## Data Flow

### Output

Current text-only flow:

1. SSHJ shell output bytes.
2. `SshTerminalService` decodes bytes to UTF-8 `String`.
3. `TerminalController.appendOutput()`.
4. `TerminalOutputFilter`.
5. Append to plain output string.
6. Compose `Text`.

New emulator flow:

1. SSHJ shell output bytes.
2. `TerminalController` receives a copied raw byte frame.
3. `RemoteTerminalEmulatorController` receives the raw byte frame.
4. Termux `TerminalEmulator.append(...)` applies escape/control sequences to its screen buffer.
5. `GoblinTerminalView` renders the current emulator screen.
6. `TerminalController` also decodes the same frame for bounded plain-text snapshots and fallback UI.

`TerminalOutputFilter` must not be used for the main emulator display because filtering destroys the control sequences that `vim`, `less`, `top`, and `codex ai` need.

### Input

Current input flow:

1. User types into `BasicTextField`.
2. User taps Send or IME send.
3. Goblin sends a line with carriage return.

New emulator flow:

1. User focuses `GoblinTerminalView`.
2. The view translates IME commits and hardware key events into terminal bytes.
3. For keys with xterm mode differences, translation uses `KeyHandler.getCode(...)` with `TerminalEmulator.isCursorKeysApplicationMode()` and `TerminalEmulator.isKeypadApplicationMode()`.
4. `RemoteTerminalOutput.write(byte[], offset, count)` forwards bytes to `TerminalSessionManager.sendInputBytes(sessionId, bytes)`.
5. Manager routes bytes to the matching `TerminalController`.
6. Controller writes bytes to the SSHJ shell output stream.

The compatibility line input may remain hidden behind fallback/debug UI, but it is no longer the primary terminal input path.

### Resize

Current resize flow:

1. Compose estimates cols from width and rows from height.
2. `TerminalSessionManager.resize(sessionId, cols, rows)`.
3. SSHJ `changeWindowDimensions(cols, rows, 0, 0)`.

New resize flow:

1. `GoblinTerminalView` measures actual font cell width and line height.
2. The view calculates cols/rows from its measured size.
3. On change, `RemoteTerminalEmulatorController.resize(cols, rows)` updates the local emulator.
4. The controller calls `TerminalSessionManager.resize(sessionId, cols, rows)`.
5. SSHJ calls `changeWindowDimensions(cols, rows, 0, 0)`.

This keeps remote applications such as `vim` aligned with the actual terminal grid.

## Session Switching And Lifecycle

Session switching:

- Detach `GoblinTerminalView` from the previous session's `RemoteTerminalEmulatorController`.
- Attach it to the new active session's controller.
- Prevent stale input from reaching the previous session through `RemoteTerminalOutput.detach()`.
- Keep all terminal records intact.
- Preserve each running session's emulator buffer while switching between workspace terminals.

Back navigation:

- Preserve existing behavior: returning from `TerminalScreen` leaves non-temporary remote sessions running.
- The emulator controller remains session-owned so it can continue consuming raw output while the route is detached.
- Temporary host terminal behavior remains controlled by the existing route logic.

Reconnect:

- Reconnect uses the existing manager/controller flow.
- The old emulator controller is detached from the failed SSH controller.
- A reconnect creates or resets the session's emulator controller before new raw output is appended.
- The plain-text snapshot remains available for fallback and restored status context.

Close:

- Close continues to show the existing confirmation dialog.
- Confirmed close calls the existing close path.
- The emulator controller detaches from input and stops accepting output for that session.

Foreground/background:

- Foreground bridge state remains based on Goblin terminal manager session state.
- The terminal emulator view does not own foreground notification state.

## Fallback And Error Handling

SSH connection failures:

- Continue using existing failed/disconnected terminal state.
- Show existing reconnect/back actions.
- Keep the last plain-text snapshot available.

Emulator initialization failure:

- Show a clear fallback panel: `Terminal emulator failed to initialize`.
- Keep reconnect/back/close actions available.
- Do not delete terminal records.
- Offer the existing plain-text snapshot as read-only fallback output.

Output bridge failure:

- Detach the emulator view binding.
- Mark view-level error state.
- Keep the underlying terminal record unless the manager reports a terminal failure.

Resize failure:

- Keep the current emulator screen.
- Surface a short non-blocking notice.
- Allow future resize or reconnect attempts to recover.

Dependency resolution failure during implementation:

- Stop implementation and revisit the design.
- Do not replace this design with an unverified terminal implementation without another design review.

## MVP Verification

Automated tests:

- Raw SSH output bytes are delivered to `RemoteTerminalEmulatorController` before plain-text filtering.
- `TerminalOutputFilter` remains limited to snapshots/fallback and is not used for emulator rendering.
- `RemoteTerminalOutput.write(byte[], offset, count)` sends bytes to `TerminalSessionManager.sendInputBytes()`.
- `sendInput(sessionId, value)` remains a compatibility wrapper around the raw byte path.
- Key translation sends expected bytes for Enter, Esc, Tab, Backspace, arrows, Ctrl+C, and plain text.
- Resize sends measured cols/rows to both local emulator resize and `TerminalSessionManager.resize()`.
- Session detach prevents stale input from reaching an old session.
- Session switch binds the view to the new session's emulator controller.
- Emulator initialization failure renders fallback state without closing or deleting a session.
- Existing terminal manager reconnect/close/delete tests continue to pass.

Manual UAT on a phone-sized Android device or emulator:

1. Open an SSH repository terminal.
2. Run `vim README.md`.
3. Enter insert mode with `i`.
4. Type text.
5. Press Esc.
6. Run `:wq`.
7. Reopen the file or `cat README.md` to confirm the edit was saved.
8. Start `codex ai`.
9. Confirm the TUI refreshes without control sequence garbage.
10. Type a prompt and submit it.
11. Use direction/selection keys and confirmation where the TUI requires them.
12. Rotate or resize the screen, then confirm `vim` redraws without obvious grid mismatch.
13. Switch away from the terminal and back, then confirm the active TUI screen is still coherent.
14. Disconnect/reconnect and confirm the terminal returns to an interactive state.

辅助 manual checks:

- `less README.md` can scroll and exit.
- `top` redraws without text accumulating endlessly.
- Backspace deletes one character in a shell prompt and in `vim` insert mode.
- Hardware keyboard arrows and software helper arrows move the cursor in `vim`.

## Source References

- Termux Libraries documentation: https://github.com/termux/termux-app/wiki/Termux-Libraries
- Termux documented library artifact version checked for this design: https://github.com/termux/termux-app/wiki/Termux-Libraries
- Termux `TerminalView` source: https://raw.githubusercontent.com/termux/termux-app/v0.118.0/terminal-view/src/main/java/com/termux/view/TerminalView.java
- Termux `TerminalSession` source: https://raw.githubusercontent.com/termux/termux-app/v0.118.0/terminal-emulator/src/main/java/com/termux/terminal/TerminalSession.java
- Termux `TerminalEmulator` source: https://raw.githubusercontent.com/termux/termux-app/v0.118.0/terminal-emulator/src/main/java/com/termux/terminal/TerminalEmulator.java
- Termux `TerminalOutput` source: https://raw.githubusercontent.com/termux/termux-app/v0.118.0/terminal-emulator/src/main/java/com/termux/terminal/TerminalOutput.java
- Termux `KeyHandler` source: https://raw.githubusercontent.com/termux/termux-app/v0.118.0/terminal-emulator/src/main/java/com/termux/terminal/KeyHandler.java
- Termux `TerminalRenderer` source: https://raw.githubusercontent.com/termux/termux-app/v0.118.0/terminal-view/src/main/java/com/termux/view/TerminalRenderer.java
- Termux repository license note: https://raw.githubusercontent.com/termux/termux-app/master/LICENSE.md

## Engineering Principles

- KISS: reuse Termux's mature emulator and key helpers instead of building ANSI/CSI, screen buffer, alternate screen, and xterm key modes from scratch.
- YAGNI: support remote SSH TUI first; do not add local shell, package management, mouse mode, graphics protocols, or Termux app integration in the MVP.
- DRY: keep Goblin's existing terminal manager as the single owner of SSH session records and lifecycle.
- SOLID: isolate Termux APIs behind Goblin adapter classes so `TerminalScreen` remains a route/lifecycle component, not a terminal engine.
