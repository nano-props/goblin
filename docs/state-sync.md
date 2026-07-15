# State and Sync

Use this doc for state control and sync rules.

## Model

Use 3 classes:

- Local state
- Runtime-coherent state
- Restorable state

Do not assume Zustand means runtime-coherent shared state.

## Local state

- Keep short-lived interaction state in component-local React state.
- Do not sync it across windows.
- Do not persist it for next launch.

Examples:

- dialog input values
- hover and open state
- temporary search state
- client-only branch filter state such as `branchSearchQueries`

## Runtime-coherent state

- Use this for state that should converge across windows during the current run.
- Let the server coordinate it.
- Treat client state as a projection, cache, or specialized runtime view of server truth.

Representative examples:

- settings query snapshots
- `useThemeStore`
- `useI18nStore`
- recent repos
- repo runtime projections, including branch, status, pull request, and operation state
- terminal sessions and control

Notes:

- `useReposStore` is not a shared cross-window store.
- `RuntimeCoherentRepoProjectionState` names the runtime-coherent repo projection slice.
- `useReposStore.repos` is a client-local projection of runtime-coherent repo truth.
- React Query is the client read model for server-owned repo runtime projections. UI and command paths should read through query-backed helpers such as `useRepoBranchReadModel` or `readRepoBranchQueryProjection` instead of treating `useReposStore.repos[*]` fields as authoritative runtime truth.
- React Query is also the client projection for server-owned settings snapshots and workspace pane tab lists. Mutation helpers should update or invalidate those caches from server-returned canonical data, not from client intent payloads.
- Store repo data may still exist as a projection for UI orchestration, action state, warm restore, and in-place server response application. New runtime reads should prefer the query-backed projection unless they are explicitly write-side projection code.
- `ReposStore` actions are also grouped by local, restorable, runtime-coherent, and mutation responsibilities.
- Transport payloads may bundle multiple classes together; consumers should split them back into runtime-coherent and restorable views before use.
- A transport payload may also bundle multiple runtime-coherent projections,
  but each authoritative model keeps its own revision. Terminal session
  snapshots and workspace-pane tab snapshots are applied independently; a
  tabs revision must never gate terminal collection recovery.
- Runtime-coherent repo actions should prefer orchestration entrypoints plus focused helper modules for projection/state transitions and sync pipelines.
- Settings truth lives on the server; clients read it through query snapshots or specialized runtime projections.
- Settings writes belong in `src/web/settings-actions.ts`. `src/web/settings-client.ts` is the transport boundary, not a UI mutation API. UI stores may keep local projections such as theme/i18n state, but their server write-through path should use settings actions so the settings query cache stays coherent.
- Workspace pane tabs truth lives in the server workspace-pane runtime. Every list or mutation returns a complete `WorkspacePaneTabsSnapshot { revision, entries }` for the repo-runtime scope. React Query accepts a snapshot only when its server revision is at least the cached revision. Canonical reorder is intentionally not optimistic; it waits for the server snapshot instead of mixing rollback tokens into the canonical cache.
- Runtime-coherent state may use server-published invalidation plus targeted refetch or realtime streaming. It must not use client polling as the mechanism that discovers server-owned changes.
- For runtime correctness boundaries, prefer server-owned fast fail over client guards. A mutation that no longer matches the live runtime should be rejected by the server, not locally guessed away by the client.
- Do not introduce client-only async tokens or focus guards to suppress late navigation after a write completes. Model the operation as a server/projection-owned pending state, reject competing user operations at their entry point, and then project the server result.
- Operation facts must be recorded in the sequential workflow that performs the operation. Examples include opener relationships, selected target supplements, and operation-owned runtime identities. Do not wait for route effects, render effects, or later reconciliation to "fill in" facts that were already known at the trigger boundary or immediately after the server accepted the write.
- If an operation cannot prove its preconditions before a write, fail before the write. Do not perform the write first and then use cleanup, delayed effects, or route repair to approximate the intended state.
- Do not mirror authoritative runtime membership from the client back into the server with whole-snapshot sync. Use server-owned open/close transitions and let the server mint runtime identities.
- Cache identity must match runtime identity. If reopen can mint a new runtime for the same stable path, cache keys and mutation preconditions need a runtime dimension too.
- Do not layer a client freshness check on top of a server-owned runtime id when the server can already validate the mutation from that id alone. That is not extra safety; it is a second authority and a new failure mode.
- After a successful server mutation, prefer invalidation from server push over client-issued "confirming" fetches. If the server already owns the durable state transition, the client should re-project from the broadcast instead of trying to restage the transition locally.
- When one user action creates a server-owned resource and must also establish
  another server-owned projection of that resource, compose those writes in a
  server application operation. Return the canonical projections together;
  do not make the client issue a provider write followed by a second membership
  write.
- Mutation responses describe the exact committed effect. Do not attach an
  unversioned full-collection read model to a mutation response and use it to
  replace concurrent state. Full collections belong to revisioned query or
  recovery snapshots.
- Server application commands, server snapshot revision, repo-runtime identity,
  and client presentation coordination have different jobs. The server command
  orders resource changes, revision orders projection responses,
  `repoRuntimeId` scopes projection/navigation, and client coordination handles
  only dedupe, cancellation, and route transitions. Do not replace any of these
  with client session-liveness or cache-generation guesses.

## Restorable state

- Use this for state that should survive relaunch, but does not need live multi-window sync.
- Restore it at boot.
- Persist later writes without creating a runtime mirror.

Representative examples:

- server-owned open-repo membership/order and durable static workspace-pane layout
- client-local workspace state (active repo, route, layout, selection, and filetree view)
- `repoSnapshotCache` for warm restore
- boot-only `useSessionRestoreStore`

Notes:

- `ServerWorkspaceState` contains shared open-repo membership/order and
  restart-durable static pane layout. Explicit server layout commands persist it.
- `ClientWorkspaceState` is persisted in stable native `userData` storage for
  Electron and browser local storage for Web. Native storage must not depend
  on the embedded server's dynamically allocated origin.
- At boot, the server reads `openRepoEntries` from its workspace state. Later
  membership changes use fine-grained server open/close commands, not a client
  whole-workspace snapshot.
- Lazy repo promotion sends only the repo root and server-issued runtime id.
  The server resolves the canonical entry and durable pane layout from current
  workspace membership. Do not carry membership or server layout in a client
  restore intent or baseline write-back.
- Boot keeps `ClientWorkspaceState` and `ServerWorkspaceState` separate. The client never constructs or writes a combined session snapshot.
- `repoSnapshotCache` names the warm-start repo cache slice.
- `RepoSnapshotCacheEntry` is the stored snapshot shape inside that cache.
- Restorable helpers should focus on boot restore and persistence boundaries, not on live runtime convergence.
- `repoSnapshotCache` is a startup affordance, not a runtime authority. Persist it from query-projected repo data when available; use it to paint placeholders during boot, then converge through normal server/query refresh.
- `hydrateRestoredWorkspaceRuntime` belongs to the restorable boot path, while
  `ensureWorkspaceOpen` and `closeRepo` belong to runtime repo lifecycle.
- Restorable state is not runtime-coherent shared state.
- Do not add a whole-session client -> server write. Each side persists only the state it owns.
- Explicit workspace pane layout commands persist their durable static layout
  before committing the canonical runtime projection.
- Restore repairs invalid durable pane-layout targets with a repo-local compare-and-clear operation. It must not rebuild
  the whole workspace or overwrite tabs that changed after validation.
- Workspace pane target preference distinguishes three states: no target (`null` render selection), uninitialized target (use `INITIAL_WORKSPACE_PANE_TAB`), and explicit empty pane (`preferredWorkspacePaneTabByTarget[targetKey] === null`). Do not use `status` as a fallback for route misses, projection misses, or bare branch URLs.
- URL-backed workspace pane routes are the visible-pane source of truth. Client preference and selected runtime-session state are restorable projection supplements, not command authorities. Internal workspace-pane commands must decide their target route and write the matching preference/selection supplement through the navigation action that accepted the route.
- Route effects may sync an externally arrived URL (manual address entry, browser Back/Forward, restore) into preference/selection so the restorable projection stays coherent. Command correctness must not depend on those effects running after the route changes.
- Workspace-pane navigation APIs must report whether navigation was accepted. If the branch target is blocked, missing, stale, or cannot produce a route, the command should fail fast instead of silently returning, inventing a fallback tab, or relying on reconciliation to repair a half-state.
- Native-only validation or registration may feed back into server-owned runtime settings and then converge through invalidation/refetch.

## Sequential command workflows

Workspace-pane command classification and the queue/token/CAS concurrency matrix are normative in
`workspace-pane-command-invariants.md`.

User operations that combine server writes, client projection supplements, and
route changes must be modeled as one ordered workflow. At the operation entry
point, read the current route and projection once, prove the preconditions, and
derive the exact business facts the operation owns: target route, opener,
close-back target, insertion anchor, selected runtime session, and any server
write input. Then run the write and commit only the result that was already
planned.

Do not split a command into "start a write now, then fix navigation/state later"
pieces. In particular:

- Do not use render effects, route effects, delayed callbacks, or background
  observers to fill facts the command already knew.
- Do not add client-only freshness tokens, focus guards, or post-await
  "is the user still here?" checks to decide whether the command should
  navigate.
- Do not navigate first to hide an unresolved write, unless the product action
  itself is explicitly a navigation command.
- Do not let route reconciliation invent a successful target for a command.
  Reconciliation may canonicalize externally arrived stale URLs or wait for a
  real runtime lifecycle state; it is not a command repair layer.

The normal shape is:

```ts
const plan = resolveOperationPlan(currentRoute, currentProjection)
if (!plan.ok) return false
const result = await performServerOrRuntimeWrite(plan.write)
if (!result.serverCommitted) return false
applyCanonicalProjectionWhenCurrent(result.canonicalProjection)
return await commitPlannedNavigation(plan.route)
```

Keep server commit, local projection application, and route completion as
separate outcomes. A server response that belongs to an old client runtime may
be skipped by the local cache without reclassifying the server write as failed.
After the server commit point, route failure is recoverable UI state and must
not trigger destructive compensation against a long-lived runtime resource.
Operation-owned navigation must settle against the requested route; merely
scheduling `router.navigate(...)` is not completion.

If a runtime write has a visible transitional lifecycle, project that lifecycle
through the owning runtime model without contradicting the current business
state. Do not hide or remove an entity from a client projection before the
runtime write that removes it has actually completed, then try to compensate
with a secondary "closing" flag, render override, or route-reconciliation
exception. That creates two sources of truth: the projection says the entity is
gone, while the command still owns an in-flight close.

The cleaner shape is sequential: the command captures the close-back target,
awaits the owning runtime close, and only then commits both the projection
removal and planned navigation. Reconciliation may wait on real runtime state,
but it must not become a repair layer for an operation that prematurely hid its
own target.

## Sync rules

- Use invalidation plus refetch for runtime-coherent state that changes occasionally.
- Use streaming only for continuous flows such as terminal output.
- Do not add `refetchInterval`, `setInterval`, or timer loops to keep runtime-coherent server state fresh. Publish a server invalidation event at the write/lifecycle boundary, or use a streaming channel when the data is continuous.
- Treat session restore as boot-only.
- Keep visual preview and animation state local. Do not persist it, sync it, or write it to server/query caches except through the actual server mutation it previews.
- For server mutations that return canonical state, write that returned value into React Query. For mutations that only publish invalidation, invalidate the query and let the next read project server truth.
- Suppress self-echo when a client mutation causes its own invalidation event.
- Do not keep a mutation alive with client-side compensation after its runtime precondition has gone stale. Fail fast and let the next read/refetch re-project truth.
- If the client cannot prove a runtime precondition from server-issued data, it should not invent one locally. Ask the server, or fail.
- "Fail" here means reject the mutation cleanly. It does not mean silently downgrading into a local-only approximation that keeps the UI moving while runtime truth has already diverged.

## Rules of thumb

- If the state only matters during one interaction, keep it local.
- If the state must converge across windows right now, make it runtime-coherent.
- If the state only needs to come back on next launch, make it restorable.
- Let the server own runtime-coherent truth for settings, repo data, and terminal state.
