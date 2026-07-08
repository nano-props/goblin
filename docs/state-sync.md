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
- Runtime-coherent repo actions should prefer orchestration entrypoints plus focused helper modules for projection/state transitions and sync pipelines.
- Settings truth lives on the server; clients read it through query snapshots or specialized runtime projections.
- Settings writes belong in `src/web/settings-actions.ts`. `src/web/settings-client.ts` is the transport boundary, not a UI mutation API. UI stores may keep local projections such as theme/i18n state, but their server write-through path should use settings actions so the settings query cache stays coherent.
- Workspace pane tabs truth lives in the server workspace-pane runtime. React Query caches the runtime projection. Reorder may use a short-lived optimistic query update, but success must replace it with server-returned tabs and failure must rollback or invalidate.
- Runtime-coherent state may use invalidation plus refetch or realtime streaming.
- For runtime correctness boundaries, prefer server-owned fast fail over client guards. A mutation that no longer matches the live runtime instance should be rejected by the server, not locally guessed away by the client.
- Do not introduce client-only async tokens or focus guards to suppress late navigation after a write completes. Model the operation as a server/projection-owned pending state, reject competing user operations at their entry point, and then project the server result.
- Do not mirror authoritative runtime membership from the client back into the server with whole-snapshot sync. Use server-owned open/close transitions and let the server mint runtime identities.
- Cache identity must match runtime identity. If reopen can mint a new instance for the same stable path, cache keys and mutation preconditions need an instance dimension too.
- Do not layer a client freshness check on top of a server-owned runtime id when the server can already validate the mutation from that id alone. That is not extra safety; it is a second authority and a new failure mode.
- After a successful server mutation, prefer invalidation from server push over client-issued "confirming" fetches. If the server already owns the durable state transition, the client should re-project from the broadcast instead of trying to restage the transition locally.

## Restorable state

- Use this for state that should survive relaunch, but does not need live multi-window sync.
- Restore it at boot.
- Persist later writes without creating a runtime mirror.

Representative examples:

- saved session state
- workspace layout and pane sizes
- active repo and open repo set for next launch
- `repoSnapshotCache` for warm restore
- boot-only `useSessionRestoreStore`

Notes:

- `RestorableWorkspaceState` names the workspace fields that serialize into `WorkspaceSessionState`.
- `repoSnapshotCache` names the warm-start repo cache slice.
- `RepoSnapshotCacheEntry` is the stored snapshot shape inside that cache.
- Restorable helpers should focus on boot restore and persistence boundaries, not on live runtime convergence.
- `repoSnapshotCache` is a startup affordance, not a runtime authority. Persist it from query-projected repo data when available; use it to paint placeholders during boot, then converge through normal server/query refresh.
- `hydrateSession` belongs to the restorable boot path, while `ensureWorkspaceOpen` and `closeRepo` belong to runtime repo lifecycle.
- Restorable state is not runtime-coherent shared state.
- Session writes are client -> persistence only after boot restore; they do not publish runtime invalidation.
- Workspace pane tabs in saved session state are boot-only import data. After restore, runtime tab changes flow server -> React Query -> later persistence; saved session data must not become a live tab authority.
- Native-only validation or registration may feed back into server-owned runtime settings and then converge through invalidation/refetch.

## Sync rules

- Use invalidation plus refetch for runtime-coherent state that changes occasionally.
- Use streaming only for continuous flows such as terminal output.
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
