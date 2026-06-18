# Terminal: first-frame bug fix note

> **Status**: implemented bug fix note.
> Scope: `create` first-frame protocol, renderer reconciliation, and the follow-up false-error fix.

## Background

The terminal feature already treated `attach` / `restart` as replay-aware operations: the server could return a snapshot boundary, and realtime output around that boundary had dedicated handling.

`create` was different. It created a usable terminal session, but the renderer's first visible frame still depended on a race between multiple channels:

- the `create` response
- live realtime `output`
- a follow-up `session-snapshot` fetch
- later `sessions-changed` / list-session reconciliation

In practice, this showed up most clearly in `bun dev`, where development-only remount behavior widened the timing window and made the underlying protocol gap more visible.

## User-visible symptoms

The bug report had several variants of the same underlying problem:

- the first terminal opened blank
- opening another terminal or revisiting the first terminal caused content to appear later
- the first prompt could be torn or partially replayed
- zsh could render an isolated inverse-video `%`, which strongly suggested prompt / ANSI boundary splitting instead of a simple blank paint

A later iteration of the fix also revealed a second symptom:

- the terminal could visibly appear, but the UI still showed a "failed to create terminal" toast

That second symptom turned out to be a separate renderer-side success-criteria bug, documented in §"False failure after a successful create".

## Root cause

The root cause was not "WebSocket is wrong" and not primarily "StrictMode is weird".

The real problem was that **`create` did not have an atomic first-frame protocol**.

More specifically:

1. the server already knew the created session's first-frame snapshot during `create`
2. but the public `create` response did not treat that snapshot as the authoritative handshake
3. the renderer therefore had to reconstruct the first visible frame from several asynchronous sources
4. `create` also lacked the same realtime pause boundary that `attach` / `restart` already had

That made the first prompt vulnerable to timing races.

## Fix goals

The bug fix established a stricter contract for `create`:

- `create` must return the created session's first-frame hydration data directly
- the renderer must treat that payload as the authoritative first-frame handshake
- `create.sessions` must not be used as the success criterion for first paint
- realtime output around `create` must follow the same boundary discipline as `attach` / `restart`

## Implemented protocol changes

### 1. `create` now returns first-frame hydration fields

The `create` success payload now includes the same class of information the renderer already relied on for `attach` / `restart`:

- `sessionId`
- `processName`
- `canonicalTitle`
- `phase`
- `message`
- `snapshot`
- `snapshotSeq`
- `controller`
- `canonicalCols`
- `canonicalRows`

This makes `create` self-sufficient for the first visible terminal frame.

### 2. `create` now participates in the realtime pause boundary

The server now treats `create` like `attach` / `restart` for the purpose of buffering per-socket output while the snapshot-bearing response is being prepared.

This does not mean every byte produced "during create" must appear in a later live output event. It means the snapshot-bearing response itself is now the authoritative boundary, instead of forcing the renderer to race live output against a partially initialized local session.

### 3. the renderer now hydrates directly from the `create` response

After a successful `create`, the renderer no longer depends on a follow-up snapshot fetch to paint the first frame.

The local session is reconciled directly from the `create` payload.

## `create.sessions` is not the first-frame truth source

One subtle but important design rule came out of this bug:

- `create.sessionId` + `snapshot` + `snapshotSeq` are the **authoritative first-frame handshake**
- `create.sessions` is only **projection / directory data**

That distinction matters because the `sessions` array serves a different purpose.

### What `create.sessions` is actually for

It is useful for renderer projection tasks such as:

- updating the tab strip
- reflecting terminal count and order for a worktree
- projecting session metadata like title / phase / controller / geometry
- reducing the need for an immediate extra list-sessions round-trip

In other words, it is a **directory snapshot**, not the created session's primary source of truth.

### Why treating it as authoritative is dangerous

If the renderer insists that the returned `sessions` array must already contain the newly created session, it introduces a second consistency requirement that is separate from first-frame correctness.

That is exactly how the later false-error toast happened:

- the created terminal already had enough authoritative data to render successfully
- but the returned `sessions` list could still lag the created session
- the renderer incorrectly treated that lag as a create failure
- the user saw both a visible terminal and a "failed to create terminal" toast

The fix was to stop using `create.sessions` as a success oracle.

## False failure after a successful create

After the first-frame protocol fix landed, a renderer-side bug surfaced more clearly:

- the terminal could appear successfully
- but the create promise could still reject
- the empty-state CTA then showed a terminal-create-failed toast

The renderer was doing an overly strict validation step:

- it required `sessionId`, `snapshot`, and `snapshotSeq` from the `create` payload
- **and** it also required the returned `sessions` list to already include the created session

That extra requirement was removed.

When the returned session list lags the created session, the renderer now:

1. trusts the authoritative `create` payload for first paint
2. synthesizes temporary projection data if needed
3. lets later session-sync / reconciliation catch up normally

## Why this fix is correct even outside the reported bug

This is not a one-off workaround for one screenshot.

It is a protocol correction.

`create`, `attach`, and `restart` all produce a terminal frame that the user can immediately see. They should therefore all obey the same broad rule:

- the first visible frame must come from one authoritative handshake
- renderer success must not depend on unrelated projection lag

That is the right model even when development-only remount behavior is absent.

## What this fix does not solve by itself

This note intentionally separates the first-frame protocol bug from the renderer-lifetime cleanup discussion.

A related but separate follow-up remains valuable:

- move `TerminalSessionRegistry` to a renderer-level singleton lifetime instead of a provider-owned lifetime

That cleanup is still recommended, but it is **not required** to justify the first-frame protocol fix itself. The protocol bug existed on its own; development-only lifecycle behavior only made it easier to observe.

Just as importantly, this fix should not be over-claimed:

- it closes the main first-frame atomicity gap for `create`, aligning it with `attach` / `restart`
- it does **not** mean every terminal consistency concern is now solved
- session-list projection, ownership transitions, reconnect behavior, and runtime lifetime remain separate correctness surfaces

A useful summary is:

- **first-frame atomicity is now closed on the main mutation paths**
- **the terminal system as a whole is not therefore "fully complete"**

See `docs/terminal-roadmap.md` for the remaining follow-up directions.

## Review findings and implementation notes

The implemented fix is directionally correct, but the review surfaced a few distinctions that should stay explicit.

### Core fix that should remain

These changes are the actual root-cause correction and should be preserved:

- `create` returns first-frame hydration fields directly
- `create` participates in the same realtime pause boundary as `attach` / `restart`
- the renderer hydrates directly from the `create` payload
- `create.sessions` is treated as projection data rather than the success oracle for first paint

### Transitional type shape

The shared `TerminalCatalogMutationResult` type is currently in a transitional state.
It allows the `create` success payload to expose the new hydration fields through a partial attach-like shape, while the renderer still enforces the required fields at runtime.

That is acceptable as a short-term compatibility step, but it is not the clean final state.
A follow-up should tighten the shared type so the first-frame fields are required at the type level, not only by renderer-side validation.

### Secondary patch: same-session snapshot reapply

A renderer-side patch also broadened `ManagedTerminalSession.hydrate()` so an already-open xterm may be reset and rewritten when a newer snapshot arrives for the same session id.

This is not the core protocol fix.
It may still be useful as a repair path, but it should be treated as a secondary patch rather than part of the first-frame root-cause correction.
If future review wants a narrower protocol-only diff, this is a reasonable candidate to re-evaluate separately.

### Secondary patch: delayed provider destroy

A separate renderer-side patch delays `TerminalSessionProvider` cleanup destruction by one macrotask so a development-only remount can cancel it.

This is a heuristic mitigation for provider-lifetime noise, not the protocol fix itself.
It can be kept for practical development stability, but it should remain clearly separated from the first-frame protocol correction.
If a cleaner protocol-only change set is desired, this is another reasonable candidate to revisit or drop later.

## Suggested follow-ups

1. Tighten the shared `create` success type so first-frame fields are required, not partial.
2. Decide explicitly whether the same-session snapshot reapply patch should stay as a supported repair path.
3. Decide explicitly whether the delayed provider-destroy heuristic should remain until the singleton-lifetime cleanup lands.
4. Keep the planned renderer-level singleton cleanup tracked as a separate follow-up, not as part of the first-frame protocol claim.

## Rules to preserve going forward

1. Do not use `create.sessions` as the success criterion for first paint.
2. Treat `create.sessionId` plus `snapshot` / `snapshotSeq` as the authoritative created-session handshake.
3. Keep `create`, `attach`, and `restart` aligned in first-frame semantics.
4. Treat session-list reconciliation as projection sync, not first-frame truth.
5. Keep React/provider lifetime concerns separate from terminal protocol correctness.
