# Terminal Target Model

Use this doc for the target terminal session and ownership model.

## Goal

- Make terminal lifecycle explicit.
- Make attachment ownership explicit.
- Keep the server as the source of truth for terminal business state.
- Keep renderer behavior as a projection of that model.

## Why this model is needed

The current terminal design already uses the right concepts:

- session
- attachment
- controller
- view

But the target model should make those concepts more explicit in server-owned state so reconnect, takeover, restart, and failure behavior are easier to reason about.

## Core entities

### Session

A session is the long-lived terminal business object.

It owns:

- session identity
- worktree identity
- canonical geometry
- PTY lifecycle association
- attachment set
- controller state
- render snapshot state
- lifecycle phase

A session is not the same thing as a renderer view.

### Attachment

An attachment represents one renderer attachment to a session.

It owns:

- attachment identity
- connection state
- last reported geometry
- recency information needed for reconnect and release policy

An attachment is not the same thing as the controller.

### Controller

The controller is the attachment that currently owns write and resize authority.

Controller state should be derived from:

- which attachment currently controls the session
- whether that attachment is connected (a disconnected controller clears the slot immediately; the model carries no "grace" sub-state)

### View

A view is renderer-local xterm state.

Views should never be treated as authoritative session or ownership state.

## Target server session shape

At a high level, the server-side session model should evolve toward:

- session identity and scope
- lifecycle phase
- canonical geometry
- PTY binding information
- attachment map
- controller attachment id
- render state for replay and snapshots

The important change is that the server should hold **multiple attachments per session**, not only the latest attachment state.

## Session phases

The target model should treat session lifecycle as an explicit phase machine.

## Suggested phases

- **starting**: session exists and is trying to become interactive
- **open**: PTY is live and the session is interactive
- **restarting**: session is intentionally transitioning to a replacement PTY
- **error**: session still exists as a business object, but the current PTY lifecycle attempt failed
- **closed**: terminal has been fully removed from active state

The exact names can vary, but the system should distinguish:

- active success
- transient startup
- transient restart
- recoverable failure
- terminal removal

## Why phases matter

Without explicit phases, behavior gets inferred indirectly from:

- whether a session is still in a map
- whether a PTY handle exists
- whether the renderer last saw an open state

That leads to ambiguity during restart failure, reconnect races, and delayed cleanup.

## Target attachment model

The target model should store attachments as a set or map keyed by attachment id.

Each attachment should track:

- connected or disconnected state
- most recent geometry
- whether it is eligible for implicit or explicit control transitions

This allows the server to reason about:

- controller attachment
- viewer attachments
- reconnect of the same attachment
- takeover by a different attachment
- release on disconnect (the controller slot clears immediately; ownership survives via the per-session `ownerSticky` flag, not via a per-attachment grace timer)

## Ownership roles as renderer projection

The renderer should still consume a simple ownership projection:

- controller
- viewer
- unowned

But those roles should be **derived views** of the richer session + attachment model, not the full server state itself.

That keeps the UI simple while keeping the business model accurate.

## Ownership rules

### Control authority

- only the controller may write input
- only the controller may resize the PTY
- controller changes must be server-authoritative

### Attach behavior

- attach may preserve existing control
- attach may restore control for a reconnecting controller
- attach may create a viewer
- attach should not silently override an unrelated active controller

### Disconnect behavior

- disconnect should clear the controller slot immediately, not preserve it
- a subsequent attach from the same owner (any attachment) auto-claims when no controller is present, because `ownerSticky` is sticky per session
- releasing control should not require the renderer to guess what happened

### Takeover behavior

- takeover is an explicit control transition
- takeover should update canonical geometry coherently with the new controller
- renderer optimism should stay minimal; server ownership events remain authoritative

## Geometry in the target model

Geometry should be represented at two levels:

- **canonical session geometry**: the server-owned PTY size
- **attachment geometry**: the last known geometry of each attachment

This allows the system to reason about:

- which attachment currently defines PTY size
- whether a control transition requires a resize
- whether reconnecting control should restore the attachment's geometry

Geometry acquisition belongs to the orchestrator, not the view. The view accepts a measured geometry as a parameter and never reaches into layout.

## Restart semantics in the target model

Restart should be modeled as a lifecycle transition, not as an attach-shaped side effect.

### Desired properties

- the session identity may remain stable for product continuity
- the PTY binding may change
- the phase makes restart visible and explainable
- failure can be expressed as `error` rather than as a half-alive session

## Reconnect semantics in the target model

Reconnect should be attachment-aware.

That means the model should be able to answer:

- is this attachment the previous controller reconnecting?
- is this a different attachment attaching as a viewer?
- should control be restored, preserved, or released?

## Renderer implications

The renderer does not need the full server model.
It mainly needs:

- session summary
- current ownership projection for this attachment
- canonical geometry
- replay snapshot
- lifecycle phase

The renderer should not have to infer hidden lifecycle meaning from missing PTY state.

## Migration direction

All five steps are landed as of this revision. The renderer-side
projection (steps 3 + 5) is centralized in
`src/web/components/terminal/authority-gate.ts`; see
`terminal-takeover.md` for the resulting ownership model.

## Success criteria

The target model is successful when:

- restart failure has an explicit and testable meaning
- reconnect behavior is attachment-aware
- mirror and takeover semantics remain clear
- canonical geometry is owned and updated consistently
- renderer logic becomes simpler because server lifecycle is clearer
