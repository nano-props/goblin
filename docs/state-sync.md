# State and Sync

Use this document to classify state, assign authority, and choose convergence
mechanisms.

## Core model

Every state value belongs to one of three classes:

- **Local**: matters only to one interaction or presentation.
- **Runtime-coherent**: must converge between clients during the current run.
- **Restorable**: should return after relaunch but does not require live
  multi-client convergence.

A library or container does not decide the class. A client store can hold a
projection of runtime-coherent server truth, and a server payload can contain
both runtime-coherent and restorable data; ownership remains explicit.

## Local state

Keep short-lived input, hover, open, search, animation, and pending
presentation state local. Do not persist or synchronize it unless the product
contract explicitly promotes it to another class.

Local presentation is a best-effort projection. A harmless passive miss may be
corrected locally, but failure that affects an accepted user action or makes
visible state uncertain must be surfaced and returned to explicit recovery.

## Runtime-coherent state

- The server owns runtime-coherent business truth. Clients hold query caches,
  projections, or specialized runtime views of that truth.
- Client intent payloads do not authorize server commands or replace canonical
  response data.
- Each authoritative model has its own identity and revision. Bundling several
  projections in one payload never makes one revision a freshness proxy for
  another.
- Runtime identity is part of cache identity and mutation preconditions when a
  stable locator can be reopened into a new live generation.
- Prefer server-published invalidation plus focused reads for occasional
  changes, and streaming for continuous data such as terminal output.
- Do not use polling, background repair, or confirming reads to rediscover a
  server transition that the owning write boundary can publish directly.
- A client cache never becomes a fallback authority when a runtime read fails.

Settings, workspace membership, repository reads, workspace-pane runtime tabs,
and terminal sessions are representative runtime-coherent domains. Their
client projections may use different state libraries without changing their
authority.

### Mutation convergence

- The authoritative write boundary returns the exact committed effect and
  publishes invalidation when a complete read model must converge.
- Complete the operation's authoritative steps and settle its visible
  lifecycle before publishing repository read invalidation. Repository membership
  reads use the physical repository write boundary only as an admission epoch.
  The epoch covers the admitted attempt to invoke `git worktree add/remove`,
  not bootstrap, branch cleanup, settings persistence, or the enclosing
  operation lifecycle. It does not claim that a local Git process or remote Git
  command observably started. A pre-spawn cancellation may therefore cause one
  conservative, retryable read conflict even when the command reports
  `not-started`; revisions are not rolled back and clients do not compensate.
  Reads fail directly while the attempt is active and reject a successful
  result if the epoch changed while they were running. A read that fails keeps
  its own cancellation or typed runtime error so the existing lifecycle owner
  can settle it. A mutation that may have run publishes invalidation so a later
  read can converge; a conservative `not-started` conflict fails fast and leaves
  retry to an explicit user action. The
  boundary never filters paths, derives membership, or publishes mutation
  invalidation; one complete Git read remains the authority and the application
  write path remains the single owner of exact post-operation invalidation.
- Keep four facts separate: whether the target mutation command was invoked,
  which domain steps definitely committed, which projections must be
  invalidated, and which recovery message the user receives. A later command
  outcome cannot erase an earlier committed milestone.
- A command that returns an error may still require conservative invalidation.
  Preserve its domain reason unless execution ended by cancellation or timeout,
  or a remote command start could not be confirmed. In those cases, the owning
  application flow may normalize `message` to explicit check-state guidance
  because the command may have changed repository state.
  A confirmed partial success adds recovery guidance for its specific follow-up;
  do not replace errors through a cross-operation message classifier.
- Public mutation failures keep the established domain `message`, subject to
  that execution-uncertainty normalization, and may add bounded
  `recoveryMessageKeys` for confirmed partial successes or lifecycle settlement
  uncertainty. These keys are
  presentation guidance only: they do not carry execution facts, authorize
  cleanup, drive invalidation, or let the client infer repository state.
- System Git and SSH boundaries return execution facts and domain effects, not
  recovery presentation. The server application flow derives recovery notices,
  publishes mutation impact once, and attempts typed runtime settlement at the
  request boundary. Settlement failure never replaces a mutation result that
  was already established.
- The workspace lifecycle authority publishes a committed failed transition;
  the background-sync owner then removes that exact runtime from automation.
  A failed remote lifecycle also closes server-side Git admission and releases
  queued repository writes for that runtime with a stale-runtime failure. Git
  capability requires both a ready probe and a ready remote lifecycle.
  If lifecycle settlement itself becomes uncertain, the request or background
  operation asks the same background owner to stop it directly. A later
  explicit client registration may admit it again; the server does not keep
  retrying a failed or uncertain lifecycle.
- A client may apply canonical response data or invalidate the owning query. It
  must not replace a concurrent collection with an unversioned snapshot or
  reconstruct the write from its request payload.
- Repository operation activity is process-local coordinator authority. Its
  projection reads coordinator memory and never probes Git or SSH, so an
  operation invalidation cannot start remote work while lifecycle failure is
  still settling.
- When one user action changes a resource and another server-owned projection
  of that resource, compose both changes in one server application operation.
  Do not make the client issue a second write to repair membership.
- A stale client may skip applying a response to its local projection without
  reclassifying the already-committed server write as failed.
- Client projection failure never owns rollback of a long-lived server
  resource.

### External authority

Git changes made through terminals or external tools are out-of-band. The app
does not coordinate with them through locks, repeated admission checks,
compensation, rollback/replay, compatibility fallbacks, hidden retries,
watchers, recovery jobs, or a second cache authority. If external state blocks
an app operation, fail directly and let the user repair, retry, or reopen. A
later supported read only needs to converge to the resulting Git state.

## Restorable state

- Persist only state whose owner needs it after relaunch.
- Server-owned durable state includes workspace membership and static
  workspace-pane layout.
- Client-owned durable state includes presentation preferences, route and
  selection supplements, layout, and file-tree view preferences.
- Live runtime membership and server-issued runtime identities are restored by
  server lifecycle operations, not replayed from client snapshots.
- Client and server persistence remain separate. Do not create a combined
  whole-session payload or a client-to-server whole-state write.
- Restore is a boot concern. Once ready, live changes use normal runtime
  commands and convergence paths.
- Persistence remains closed until its owner's restore boundary has completed.

Restorable preferences supplement runtime truth; they never authorize commands
or force a missing runtime object back into existence.

## Sequential user commands

A user operation that combines server writes, client projection supplements,
and navigation is one ordered workflow:

1. Read the relevant route and authoritative projection once at the command
   boundary.
2. Prove preconditions and derive the exact facts owned by the command.
3. Perform the authoritative write.
4. Apply accepted canonical projection data or invalidation.
5. Settle the navigation that was planned for that result.

Keep server commit, local projection, and route completion as separate
outcomes. After the server commit point, projection or navigation failure is
recoverable UI state; it does not trigger destructive compensation.

Do not use render effects, route effects, delayed callbacks, background
observers, client freshness tokens, or post-await location checks to fill facts
the command already knew. Reconciliation validates externally arrived state;
it does not invent a successful target or repair a half-finished command.

If a write has a visible transitional lifecycle, project that lifecycle from
the owning runtime model. Do not optimistically remove the business object and
then add a secondary flag or render override to pretend it still exists.

## Workspace-pane state

- Durable static layout, command-time target validity, runtime placement, and
  live provider membership have distinct owners and feed one canonical tab
  projection.
- Client route, selection, opener, and preference state are presentation
  supplements. They never authorize server commands or mirror runtime
  membership back to the server.
- Explicit URLs remain navigation authority. A missing or unrenderable target
  produces an empty/not-found state until an explicit user command chooses
  another route; effects do not invent fallback navigation.
- Target preference distinguishes uninitialized, explicit empty, and explicit
  target states. Do not collapse them through a default-tab fallback.
- Detailed queue, revision, compare-and-swap, and navigation concurrency rules
  live in `workspace-pane-command-invariants.md`.

## Rules of thumb

- One interaction: local.
- Cross-client convergence now: runtime-coherent and server-owned.
- Return after relaunch: restorable and owned by the side that consumes it.
- Continuous data: stream. Occasional change: invalidate and read.
- Unprovable runtime precondition: ask the server or fail.
- Uncertain outcome: stop automation, preserve established facts, and return
  recovery to the user.
