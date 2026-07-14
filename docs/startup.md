# Startup Architecture

The primary window boot path has two separate concerns: public shell hydration and authenticated workspace restore. Keep new startup work in the narrowest stage that owns the data it needs.

## Stages

1. Public bootstrap
   - Owner: `usePublicAppBootstrap`.
   - Runs before authentication completes.
   - Allowed work: unauthenticated-safe client state such as theme, host-independent shell defaults, and public cache priming.
   - Must not read or write workspace session state.

2. Token gate
   - Owner: `TokenGate` and `useAccessTokenStatus`.
   - Validates `/api/whoami`, exchanges URL tokens through `/api/login`, and removes URL tokens before any network hop.
   - Uses a timeout-backed abort controller. Cleanup cancels the active auth check and must not update React state after unmount.

3. Authenticated workspace restore
   - Owner: `useAuthenticatedAppBootstrap`.
   - A single restore run owns the settings snapshot, non-critical authenticated hydration, workspace session restore, timeout, and cleanup cancellation.
   - The hook exposes an explicit shell state: `{ status: 'restoring-workspace' }` or `{ status: 'ready' }`.
   - The run returns an explicit outcome: `completed` or `cancelled`. Only `completed` may transition the authenticated shell to `{ status: 'ready' }`.
   - Cleanup cancellation is not a restore failure. Timeouts and actual restore errors are failures and must leave enough state for the UI to render without opening persistence.

4. Workspace membership restore
   - Owner: server `restoreServerWorkspace` and client `hydrateRestoredWorkspaceRuntime`.
   - The server validates repo identity, eagerly projects the routed repo, and returns other or temporarily unavailable repos as stub leases.
   - Produces the restored repo membership and placeholder repos. `workspaceMembershipReady` means membership has settled; repo content may still be loading.
   - If the restore signal is aborted, this stage must return without flipping `workspaceMembershipReady`.

5. Lazy repo promotion
   - Owner: `useRestoreRepoTabsOnView` and server `restoreRepoTabsForRepo`.
   - When navigation reaches a stub, the server projects that repo and restores tabs from the current server-owned `ServerWorkspaceState`.
   - The client sends only its repo entry and server-issued runtime identity; it never sends a canonical tabs snapshot back to the server.
   - Availability failures leave the stub and membership intact so a later navigation can retry.
   - If the current repo projection proves persisted pane-tab targets invalid, the server clears only that repo's
     unchanged tab state before initializing the runtime scope. Concurrent tab writes win the repo-local comparison.

6. Workspace shell side effects
   - Owner: `AuthenticatedWorkspaceShell` and `AuthenticatedWorkspaceSideEffects`.
   - Runs only after authenticated bootstrap is ready.
   - Uses the routed repo id from the URL as the durable source of truth, and the hydrated repo id only for operations that require repo data.

## Readiness Model

The repos store keeps low-level fields because different UI surfaces need different boundaries:

- `workspaceMembershipReady`: restored repo membership has settled.
- `sessionPersistenceReady`: server workspace restore and client-local workspace hydrate have both converged.
- `sessionRestoreError`: restore failed in a way that must block persistence.

Code that needs the combined state should use `workspaceRestoreStatusFromStore` or `workspaceSessionPersistenceOpenFromStore` from `src/web/stores/repos/selector-state.ts` instead of recombining booleans at call sites.

## Routing Rules

- Repo routes derive `RepoRouteView` directly from the URL before store hydration.
- A routed repo may be missing from the repo store while workspace membership is restoring. Render restore skeletons until `workspaceMembershipReady` is true.
- After membership is ready, a routed repo missing from the store is a not-found state, not an empty placeholder.
- Client workspace persistence should prefer the routed repo id over `restoredRepoId`.

## Persistence Rules

- Server workspace-tab commands persist canonical `ServerWorkspaceState` directly.
- The client persists only `ClientWorkspaceState`: in native `userData` for
  Electron, and in local storage for Web.
- The server reads the shared `ServerWorkspaceState.openRepoEntries` membership at boot;
  the server returns canonical entries and runtime identities.
- Do not compose client and server workspace persistence into a whole-session payload.
- Do not persist client workspace state until `workspaceSessionPersistenceOpenFromStore` is true.
- High-frequency client state may be debounced; pagehide flush is synchronous and local.

## Adding Startup Work

When adding startup behavior, choose one stage and document why it belongs there.

- Public, unauthenticated work goes in public bootstrap.
- Authenticated but non-blocking work can run as an optional task in authenticated bootstrap and must log but not block workspace restore.
- Work that affects repo membership belongs in `hydrateRepoSession`.
- Work that affects boot composition must complete before `sessionPersistenceReady` opens.
- Work that needs hydrated repo data but is not part of restore belongs in workspace shell side effects.

Every async startup task needs a cleanup story: cancellation must not commit success, unblock persistence, or set React state after unmount.
