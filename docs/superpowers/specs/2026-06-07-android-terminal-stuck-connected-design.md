# Android Terminal Stuck Connected Design

## Problem

Android terminal sessions can sometimes appear as `connected` after a long idle period inside Codex or another AI CLI, but user input no longer reaches the remote shell and the session can feel stuck.

The current terminal status is based on SSHJ connection and channel flags. Those flags can remain true for a half-open SSH connection or a blocked channel write. The input path also queues writes on a terminal I/O executor and returns success to the UI after enqueueing, not after the remote write completes.

## Goals

- Keep normal Codex/AI idle sessions alive without sending probe text into the interactive prompt.
- Detect write-stuck or half-open sessions when user input cannot be delivered.
- Keep `Close` and `Reconnect` usable even when an input write is blocked.
- Surface a specific disconnect reason instead of leaving the UI at `connected`.

## Non-Goals

- Do not add shell-level active probes that write marker commands into the terminal by default.
- Do not change SSH authentication, startup `cd`, terminal rendering, or Termux handoff behavior.
- Do not classify lack of terminal output as failure.

## Recommended Approach

Add a write watchdog for terminal input and resize operations.

When Goblin sends bytes to the terminal, the session manager should track a pending write. If the write does not complete within a short timeout, the session should be marked disconnected with `TerminalDisconnectedReason.TerminalWriteTimeout` and a specific message such as `terminal write timed out`. This catches the important failure mode where SSHJ still reports the channel as open but `write` or `flush` is blocked.

Close and reconnect should not depend on the same single terminal I/O queue used by writes. If a write is stuck, the user must still be able to close the session record and attempt to close the underlying SSH resources.

Existing SSHJ keepalive remains in place. It handles connections that clearly become closed. The new watchdog handles half-open or blocked-write cases.

## Data Flow

1. UI sends input through `TerminalSessionManager.sendInputBytes()`.
2. Manager records a pending write deadline and dispatches the write in background.
3. If the write succeeds before the deadline, manager clears the pending write and updates `lastActivityAt`.
4. If the deadline is exceeded, manager marks the session as disconnected and detaches it from attachable/running state.
5. UI observes the session record and shows a disconnected banner plus `Reconnect`.
6. `Close` remains independently available and should not wait for pending writes to finish.

## Error Handling

- Write timeout should become `TerminalDisconnectedReason.TerminalWriteTimeout` with a clear `disconnectedMessage`.
- Repeated timeout handling must be idempotent. A session already disconnected or closed should not be updated again by an old watchdog callback.
- A late successful write after timeout must not restore the session to running.
- Normal idle with no user input should not trip the watchdog.

## Testing

Add focused JVM tests around terminal session behavior:

- A blocked write does not keep a running session connected forever.
- A write timeout marks the session disconnected with a specific message.
- Closing a session remains possible while a write is pending.
- A normal successful write clears pending state and keeps the session running.
- Existing heartbeat behavior still passes.

## Scope

Implementation should stay inside `src/main/java/dev/goblin/android/terminals/` plus focused UI copy tests if needed. No renderer, SSH auth, or repository workflow changes are required.
