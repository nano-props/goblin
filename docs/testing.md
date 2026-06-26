# Testing Strategy

Testing should protect product behavior and architectural contracts, not mirror implementation detail. Prefer tests that describe what the user or system can observe: rendered state, enabled actions, emitted intents, persisted state, server responses, and lifecycle transitions.

Vitest remains the single test runner. Use the lightest environment that proves the behavior: plain runtime tests for pure logic and backend code, DOM-backed tests only when browser or React behavior is part of the contract.

For React UI, Testing Library is the preferred interaction layer. It should be used to render components, query by accessible semantics, and drive behavior through user-like actions. This makes tests exercise the same labels, roles, focus behavior, and disabled states that real users rely on.

Existing hand-written React test harnesses do not need a broad migration. Convert them gradually when touching nearby behavior, when a test is brittle, or when user interaction is central to the assertion. Avoid large mechanical rewrites whose main effect is churn.

Keep lower-level tests where they are valuable. Pure functions, state transitions, request validation, process boundaries, and protocol contracts should stay direct and focused. UI tests should not replace cheaper unit or contract tests when those tests express the behavior more clearly.

Use contract tests for behavior that spans layers or ownership boundaries. Lifecycle rules, realtime messages, command envelopes, persistence, validation boundaries, and process handoffs should be tested as product contracts, not as incidental helper behavior.

Design boundaries so tests can inject adapters instead of touching real infrastructure. Command transports, server clients, filesystem/process edges, and realtime producers should be replaceable with focused fakes or mocks at the boundary being tested.

For command-like surfaces, cover the observable contract: successful execution, validation failure, upstream/server failure, transport failure, and bad arguments or malformed input where applicable. Keep these tests focused on the public envelope and side effects, not internal dispatch tables.

Test data must stay privacy-safe. Use generic names, paths, remotes, timestamps, and identifiers. Tests should document intent without depending on real local machines, users, repositories, tokens, or internal infrastructure.

Every meaningful change should leave the standard verification suite green: type checking, architecture checks, and the test suite. Broaden coverage in proportion to risk, especially when changing shared behavior, cross-process contracts, persistence, realtime flow, or user-facing workflows.
