# Repository Instructions

## TypeScript and dependencies

- The project runs TypeScript in Node.js strip-only mode. Do not use enums,
  runtime namespaces, parameter properties, or import aliases.
- Pin new package versions exactly in `package.json`; do not add range prefixes.
- Use repo-alias imports with explicit `.ts` or `.tsx` extensions. Import the
  canonical module directly; do not add re-export shims.
- Type dependencies use top-level `import type` declarations, never inline
  `import('…').Type` or `typeof import('…')` expressions.
- Runtime `import('…')` is reserved for a real lazy-loading or
  optional-dependency boundary. Keep it local and explain a non-obvious use.
  Refactor circular dependencies instead of hiding them behind dynamic imports.
- Use object destructuring when the source remains obvious and the binding is
  short-lived, such as local callbacks, projections, and small local results.
  Array and tuple destructuring remain appropriate for positional contracts.
  Prefer retaining named boundary objects such as `input`, `options`, and
  `deps` in longer-lived factory, service, runtime, and repository code when
  that makes ownership clearer. Do not mechanically replace concise local
  destructuring with repeated property chains; use the form that makes both
  provenance and the surrounding logic easiest to follow. For closed domain or
  protocol boundaries, do not use object-pattern `...rest` to decide which
  fields cross the boundary; construct the boundary object explicitly.
  Open-ended platform adapters may forward their option bag when preserving
  unknown standard fields is part of the adapter contract. Refactors must
  preserve declared protocol fields and business behavior; an intentional
  boundary tightening should be reviewed separately from mechanical cleanup.
  This is a readability guideline, not a destructuring ban or a static-check
  requirement.

## Verification and test data

- Verify changes with `bun run typecheck` and `bun run test`. Use
  `bun run test:watch` for watch mode. Never invoke `bun test` directly because
  it bypasses the project test configuration and guards.
- Follow `docs/testing.md` for test placement, helpers, libraries, and
  anti-patterns.
- Keep examples, tests, documentation, and snapshots privacy-safe. Use generic
  placeholders instead of real users, paths, emails, tokens, or internal
  identifiers.
- Keep i18n keys statically traceable. Select a named `*Key` variable or a
  typed static-key map before calling `t(key)`; do not put conditionals,
  templates, concatenation, or fallbacks directly inside `t(...)`.

## UI conventions and proportionality

- Use this robustness pattern for interactive workflows: let an accepted happy
  path run directly to completion; fail fast and surface actionable errors on
  recoverable exceptions; when authority or outcome becomes uncertain, surface
  that uncertainty, stop automating, preserve already-established authoritative
  facts, and return control to the user through explicit retry, repair, reopen,
  or another deliberate recovery.
- Treat client presentation as a **best-effort projection** of authoritative
  state. Projection failure never rolls back, fabricates, or replaces an
  authoritative fact. If it affects an accepted user action or leaves visible
  state stale or uncertain, surface that condition and offer explicit recovery.
  Later authoritative hydration may converge the view, but it must not report
  an uncertain operation as successful or replay it automatically.
- Use the project `ScrollArea` (`src/web/components/ui/scroll-area.tsx`) for
  scrollable regions. Native overflow is an exception for behavior that
  genuinely requires native browser scrolling, such as terminal scrollbars.
- Hover-revealed action triggers remain visible in compact UI and while their
  popover is open. Follow `docs/ui-conventions.md`.
- Scale coordination, retries, and recovery state to evidence-backed product
  risk: likelihood, severity, data integrity, and whether the user can retry
  immediately. Missing frequency data does not make a reproducible defect
  harmless.
- Do not add second-stage handling for translation, Toast, or logger failures.
  Avoid nested catches, retries, and dedicated tests unless a concrete resource
  ownership, data integrity, or safety invariant requires them.
- Passive ordering, focus, selection, animation, or navigation effects that do
  not complete an accepted user action may be best-effort only when
  authoritative state is preserved and correction is immediate. Evaluate
  interference with explicit user actions separately.
- Proportionality never waives ownership, admission, lifecycle, authorization,
  or data-boundary invariants. Use stronger coordination for security, data
  integrity, resource ownership, irreversible writes, or concrete frequent
  harm.

## Authoritative data and root-cause fixes

- Trace a defect to its authoritative source, violated invariant, and atomic
  read/write boundary before changing behavior.
- Fix the earliest responsible boundary: normalize during decoding, enforce
  persistence invariants in repositories or transactions, and derive each
  projection from one authoritative source or model.
- Do not compensate for a data-model defect with application synchronization,
  extra coordinators, fallback state, guards, casts, or broad `try/catch`.
  Application coordination must represent a real admission, lifecycle,
  authorization, or safety boundary.
- Prefer one decisive owner and a simple fast-fail boundary over negotiation,
  compensation, hidden recovery, or compatibility protocols. Do not add such
  mechanisms merely to keep conflicting owners or obsolete paths working
  together. When a concrete cross-authority contract genuinely requires one,
  make the invariant explicit and bound its state, scope, and lifetime.
- Give an object only the state and capabilities its owner requires. Prefer a
  narrow read-only input over moving or caching a second authority.
- Growing result unions, generic failure plumbing, optional policy flags, and
  structural type probing usually indicate conflated domain concepts or
  transaction boundaries. Fix the boundary before extending the protocol.
- Reconciliation uses the complete authoritative before/after data set. Do not
  reconstruct authority from paths, handles, sessions, or other stale or
  already-deleted data.
- A green test suite confirms behavior, not ownership. Review each new queue,
  cache, guard, or synchronization mechanism by identifying the missing
  invariant it compensates for and the layer that should own that invariant.

## Documentation

- Keep `docs/README.md` as a concise index.
- Long-lived design and spec documents describe functional behavior, durable
  contracts, ownership boundaries, invariants, protocol shapes, failure
  semantics, and acceptance criteria. They should survive ordinary refactors.
- Prefer domain responsibilities over inventories of current files, functions,
  classes, component trees, or tests. Do not cite source line numbers,
  dependency internals, transient verification results, or completed migration
  history.
- Name a concrete location only when that location is itself a maintained
  convention, such as a top-level architecture area, public protocol,
  canonical entry point, or mandated shared primitive.
- Keep time-bound work in an explicitly labeled roadmap or decision record.
  Delete completed plans and stale implementation commentary once they no
  longer guide future work.

## Architecture boundaries

- Keep `bun run check:boundaries` green:
  - `src/main/**` does not import `src/web/**` or `src/server/**`.
  - `src/web/**` does not import `src/main/**`.
  - `src/server/**` and `src/shared/**` do not import `electron`.
- Prefer server-first application behavior. Add IPC only for an Electron-only
  capability that cannot reasonably use the server/browser path, and document
  that reason at the call site.

## Git operations and safety

- Read-only Git commands may run concurrently. Network Git commands are
  cancellable and coalesced per repository.
- The app guarantees correctness only for Git operations initiated through the
  app. Treat terminal and external-tool mutations as out-of-band. If they
  invalidate an operation, fail directly and require repair, retry, or reopen;
  later authoritative reads only need to converge to the resulting Git state.
- Do not coordinate with external Git tools through locks, repeated admission
  checks, compensation, rollback/replay, compatibility fallbacks, hidden
  retries, polling, watchers, recovery jobs, or a second authority.
- Avoid destructive Git features. If one is introduced, design safety,
  cancellation, and recovery before implementation.

## HTTP requests

- POST is the default for all client-to-server traffic, including reads. Use
  `postServerJson(path, body)` and bounded request bodies.
- GET is limited to WebSocket upgrades, external health checks, and genuinely
  browser-addressable URLs.
- Never put arrays, unbounded strings, or serialized objects in URLs.
- New procedures use `*_PROCEDURE_SCHEMAS`, server-side `parseHttpBody`, and an
  embedded-server IPC route entry when IPC exposure is required.
- If a GET payload changes, migrate that endpoint to the standard POST
  procedure shape in the same change. Existing GET endpoints are not precedent
  for new ones.
- Reject query-string arrays, expanding GET payloads, serialized query objects,
  and new GET endpoints without one of the allowed reasons.
