# Terminal Roadmap

Use this doc for the next-stage terminal refactor roadmap.

## Goal

- Finish the move from a PTY-coupled terminal stack to a stable server-first terminal platform.
- Reduce ambiguity around ownership, restart, reconnect, and geometry.
- Strengthen invariants before adding more product behavior on top of terminals.

## Current assessment

The current terminal refactor is directionally correct:

- business runtime is separated from PTY execution
- renderer projection is separated from local xterm view work
- ownership, mirroring, and takeover are explicit concepts
- the server remains the runtime-coherent owner of terminal truth

The remaining work is not a ground-up rewrite.
It is a second-stage consolidation that makes the current design more explicit and harder to misuse.

## Main themes

### 1. Make server session state more explicit

Today, several important terminal states are represented implicitly through combinations of:

- session presence in maps
- PTY presence or absence
- controller presence
- renderer-local open or error state

The next stage should make terminal lifecycle states explicit so create, restart, reconnect, and failure behavior become easier to reason about.

### 2. Upgrade ownership from a single-attachment model to a multi-attachment model

The current design already talks in client and attachment terms, but the server-side ownership model is still narrower than the product model it wants to support.

The next stage should model multiple attachments per session directly.

### 3. Tighten the contract between runtime semantics and UI projection

The renderer should stay a projection of server truth plus local interaction state.
The next stage should reduce places where renderer logic must infer server lifecycle indirectly.

### 4. Make invariants testable at the contract level

The terminal feature now has enough structure that contract tests become more valuable than isolated implementation tests.

## Priorities

## P1: Ownership and lifecycle model

### Outcome

- explicit session lifecycle phases on the server
- explicit multi-attachment ownership state
- clearer restart and reconnect semantics

### Why

This is the highest-leverage work because it affects:

- restart failure behavior
- reconnect behavior
- mirror and takeover correctness
- PTY resize authority
- future multi-window consistency

### Deliverables

- session phase model
- multi-attachment ownership model
- ownership transition rules
- clarified attach, takeover, resize, release, and reconnect semantics

## P1: Clarify restart failure semantics

### Outcome

- a session that fails to restart has a well-defined visible state
- no pseudo-alive sessions that look interactive but have no PTY

### Why

This is currently one of the most important sources of ambiguity in the design.
If restart failure remains implicit, renderer behavior will keep accumulating defensive logic.

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

## P2: Further tighten renderer projection boundaries

### Outcome

- clearer boundary between projection state, terminal commands, and geometry tracking

### Why

The current renderer-side registry is still healthy, but it is accumulating several kinds of responsibility.
This is not yet a crisis, so it should follow the server-side lifecycle work rather than precede it.

## P2: Add contract tests for terminal invariants

### Outcome

- tests for ownership invariants
- tests for reconnect behavior
- tests for restart failure behavior
- tests for geometry invariants
- tests for PTY supervisor parity

### Why

The next stage needs tests that verify the product model, not only helper behavior.

## P3: Split large shared terminal protocol modules by concern

### Outcome

- clearer separation of protocol, ownership types, realtime messages, and validation

### Why

This improves readability and long-term maintainability, but it is less urgent than ownership and lifecycle clarity.

## Suggested order

1. Define target lifecycle and ownership semantics
2. Refactor server session and ownership model to match them
3. Clarify restart failure and reconnect behavior
4. Split runtime orchestration into smaller modules
5. Add contract-level tests
6. Revisit renderer-side projection cleanup
7. Split protocol modules only if still useful

## Non-goals

- Do not rewrite the terminal feature around a new UI framework.
- Do not move terminal truth into renderer-side stores.
- Do not paper over lifecycle bugs with redraw or timing heuristics.
- Do not let PTY implementation details become the product model.

## Rules of thumb

- Prefer explicit lifecycle states over implicit combinations of fields.
- Prefer explicit ownership transitions over heuristic control changes.
- Prefer server truth over renderer inference.
- Prefer geometry correctness over post-hoc rendering fixes.
- Prefer contract tests over implementation-shaped tests for terminal behavior.
