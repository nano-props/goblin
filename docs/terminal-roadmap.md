# Terminal Roadmap

Use this doc for the next-stage terminal refactor roadmap.

## Goal

- Finish the move from a PTY-coupled terminal stack to a stable server-first terminal platform.
- Reduce ambiguity around control, restart, reconnect, and geometry.
- Strengthen invariants before adding more product behavior on top of terminals.

## Current assessment

The current terminal refactor is directionally correct:

- business runtime is separated from PTY execution
- client projection is separated from local xterm view work
- control, mirroring, and takeover are explicit concepts
- the server remains the runtime-coherent source of terminal truth

The remaining work is not a ground-up rewrite.
It is a second-stage consolidation that makes the current design more explicit and harder to misuse.

## Main themes

### 1. Make server session state more explicit

Today, several important terminal states are represented implicitly through combinations of:

- session presence in maps
- PTY presence or absence
- controller presence
- client-local open or error state

The next stage should make terminal lifecycle states explicit so create, restart, reconnect, and failure behavior become easier to reason about.

### 2. Harden the multi-attachment control model

The current design now models multiple attachments per session directly:
attachments store metadata, sessions store controller intent, and broker
presence determines the effective controller projection.

The next stage should keep tightening edge-case contracts around presence,
reattach, takeover, and lifecycle transitions.

### 3. Tighten the contract between runtime semantics and UI projection

The client should stay a projection of server truth plus local interaction state.
The next stage should reduce places where client logic must infer server lifecycle indirectly.

### 4. Make invariants testable at the contract level

The terminal feature now has enough structure that contract tests become more valuable than isolated implementation tests.

## Priorities

## P1: Control and lifecycle model

### Outcome

- explicit session lifecycle phases on the server
- stronger multi-attachment control contracts
- clearer restart, reconnect, and presence-transition semantics

### Why

This is the highest-leverage work because it affects:

- restart failure behavior
- reconnect behavior
- mirror and takeover correctness
- PTY resize authority
- future multi-window consistency

### Deliverables

- session phase model
- multi-attachment control contract tests
- control transition rules
- clarified attach, takeover, resize, presence-offline, and reconnect semantics

## P1: Clarify restart failure semantics

### Outcome

- a session that fails to restart has a well-defined visible state
- no pseudo-alive sessions that look interactive but have no PTY

### Why

This is currently one of the most important sources of ambiguity in the design.
If restart failure remains implicit, client behavior will keep accumulating defensive logic.

## P1.5: Split terminal runtime orchestration into smaller server modules

### Outcome

- composition remains separate from request handling
- transport dispatch remains separate from mutation orchestration

### Why

The current runtime file still carries too many responsibilities in one place.
This is manageable now, but it will become a maintenance bottleneck as the feature grows.

### Desired shape

- runtime composition
- terminal mutation handlers / write paths
- realtime request dispatch adapter

## P1.6: Split terminal session service responsibilities (completed)

**Status: completed.** `TerminalSessionService` is now a public facade for
validation and repo-instance guard wiring. The previously inline
responsibilities are split into focused server modules:

- `terminal-session-creator.ts` owns create orchestration
- `terminal-session-create-coordinator.ts` owns per-worktree create queueing and terminal session id allocation
- `terminal-session-ensurer.ts` owns local/remote session ensure input construction
- `terminal-session-pruner.ts` owns removed-worktree session pruning
- `terminal-workspace-tabs-coordinator.ts` owns workspace tab operation queueing and read-side canonicalization
- `terminal-workspace-tabs-projection.ts` owns pure workspace tab prune/materialize/dedupe rules

The public behavior remains server-first: clients use server-returned canonical
tabs/sessions and do not infer terminal-tab projection state locally.

## P1.7: Decouple terminal runtime lifetime from React provider lifetime (completed)

**Status: completed.** `TerminalSessionProjection` is now a client-level
singleton: one instance per client process, created on first access,
living until process teardown. The `TerminalSessionProvider` is only a
wiring adapter that forwards bridge events into the singleton and
exposes its API via React context. A StrictMode re-mount no longer
recreates the projection, so the previous provider-owned lifetime and
its destroy debounce have been removed. See
`docs/terminal-session-lifecycle.md` for the bug analysis and why this
work is related but separate.

## P1.8: Make create deliver an atomic first frame (completed)

**Status: completed.** `create` now returns the full first-frame
payload (`terminalRuntimeSessionId`, `snapshot`, `snapshotSeq`, process metadata,
geometry, and controller info) directly. `TerminalCreateResult`
intersects with `TerminalFirstFrame` at the type level, and the client
hydrates from the response without a follow-up snapshot fetch.
`create.sessions` remains projection data only. See
`docs/terminal-session-lifecycle.md` for the detailed bug write-up and
contract rules.

## P2: Further tighten client projection boundaries

### Outcome

- clearer boundary between projection state, terminal commands, and geometry tracking

### Why

The current TerminalSessionProjection is still healthy, but it is accumulating several kinds of responsibility.
This is not yet a crisis, so it should follow the server-side lifecycle work rather than precede it.

## P2: Add contract tests for terminal invariants

### Outcome

- tests for control invariants
- tests for reconnect behavior
- tests for restart failure behavior
- tests for geometry invariants
- tests for PTY supervisor parity

### Why

The next stage needs tests that verify the product model, not only helper behavior.

## P3: Split large shared terminal protocol modules by concern

### Outcome

- clearer separation of protocol, control types, realtime messages, and validation

### Why

This improves readability and long-term maintainability, but it is less urgent than control and lifecycle clarity.

## Suggested order

1. Define target lifecycle and control semantics
2. Refactor server session and control model to match them
3. Clarify restart failure and reconnect behavior
4. Split runtime orchestration into smaller modules
5. Add contract-level tests
6. Revisit client-side projection cleanup
7. Split protocol modules only if still useful

## Non-goals

- Do not rewrite the terminal feature around a new UI framework.
- Do not move terminal truth into client-side stores.
- Do not paper over lifecycle bugs with redraw or timing heuristics.
- Do not let PTY implementation details become the product model.

## Rules of thumb

- Prefer explicit lifecycle states over implicit combinations of fields.
- Prefer explicit control transitions over heuristic control changes.
- Prefer server truth over client inference.
- Prefer geometry correctness over post-hoc rendering fixes.
- Apply `testing.md`'s contract-test guidance to terminal behavior.
