# Workspace Pane Command Invariants

Normative rules for workspace-pane commands, queues, routing, and tests.

## Ownership

- `WorkspacePaneLayoutRepository`: the only restart-durable static target and tab order.
- `WorkspacePaneEpochOverlay`: runtime placement constraints, physical reverse indexes, and its overlay revision.
- Server `WorkspacePaneTargetCatalog`: authoritative command-time target identities and current worktree branch metadata, captured directly from the repository source rather than cached by the aggregate. Client `RepoSnapshot` is presentation-only and cannot authorize server commands.
- `WorkspacePaneLayoutAggregate`: the canonical epoch projection clock derived from durable layout, repo target projection, overlay revision, and provider revisions.
- Runtime providers: the only live runtime-session membership authority.
- Server aggregate: layout commands, target repair/retirement, and deterministic canonical projection.
- Router: visible repo, branch, and pane route.
- TanStack Query: canonical-tab projection. Repo store: restorable preferences, selection, and opener facts.
- Action queue: ordering only. Navigation generation: only the latest absolute navigation may publish a route result.

Never mirror router currentness or infer server runtime validity from client timing.

Canonical tabs are a one-way projection:

```text
durable static layout + authoritative repo target projection + epoch placement/index state + provider snapshots
-> versioned WorkspacePaneTabsSnapshot
-> TanStack Query projection
```

The overlay may retain same-epoch placement hints for a temporarily missing runtime session, but it never creates membership or copies durable static order. A missing durable target may synthesize `status`; an explicitly persisted target with `tabs: []` remains empty.

## Server Commit Order

Durable commands obey this lock order:

```text
physical worktree permit
-> workspaceId layout queue
-> settings mutation queue inside the repository adapter
-> synchronous epoch overlay commit
```

The aggregate owns the per-`workspaceId` queue and canonical epoch projection clock. A user command carries its exact membership-generation capability; a server-owned reconciliation carries its exact runtime-epoch capability. The repository carries that capability into the serialized settings mutation and acquires epoch commit ownership before the durable write. That ownership keeps the admitted epoch alive through durable publication and is the commit boundary; an entry check only avoids unnecessary work.

The repository CAS commits before overlay/revision state. A conflict re-reads current layout and re-plans the original intent. Persistence failure commits no overlay. Once the CAS is accepted, projection is a separate best-effort outcome: stale authority or projection failure must not undo or misreport the durable fact, and the caller must invalidate the visible projection and surface explicit recovery when the accepted action is user-visible. Invalid persisted targets are filtered by the authoritative Workspace/Git target projection even when repair persistence fails. Provider snapshots are sampled again after persistence before returning the canonical snapshot.

Target repair and branch retirement use the same aggregate boundary. Repair validates membership and filters invalid target keys from the settings transaction's current layout in one atomic write, preserving valid siblings without partial commits. The epoch physical index retains only a lightweight admission lease for each target: stable identity-queue admission plus the runtime-epoch signal. Current operations and removal require a separate execution capability captured at their boundary; they do not repeatedly validate filesystem generation against out-of-band changes. Stale-index cleanup uses exact lease ownership, so cleanup from an older same-path binding cannot clear a newer binding. Physical removal clears only the removed binding from affected live indexes and cannot authorize durable retirement. The authoritative server target catalog suppresses the now-invalid row, and the next membership-aware repair removes it atomically. Git failure returns directly without compensation. Git success followed by finalize failure retains an internal worktree-removed milestone and invalidates the complete captured projection scope; the public failure never describes physical deletion as rolled back.

## Commands

| Class                                          | Capture                                                  | Execute/commit                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Absolute current-target: identity/index/open   | intent and navigation generation before queue            | resolve from current projection; latest absolute intent wins; router must remain on the target                    |
| Relative current-target: next/previous         | `direction` before queue                                 | resolve route, projection, adjacent tab, and generation at execution; every queued step runs                      |
| Exact transition: active close-back            | source, destination, opener, and generation before write | never rebase; commit only while router still equals the source                                                    |
| Route-only absolute destination                | destination and target lease at admission                | reject while the same target is busy; otherwise commit independently of the source route                          |
| Resource command: create/close/open membership | write input and operation facts                          | server returns canonical projection; client accepts only the matching runtime, then follows the route class above |
| Recovery/reconciliation                        | canonical server/runtime snapshot                        | converge after server state; never repair or reclassify a user command                                            |

## Invariants

1. Every queued command keeps its admission lease: `workspaceRuntimeId`, branch, and worktree. It cannot cross an epoch or worktree replacement.
2. Relative intent remains relative until execution and runs once in queue order. Absolute intent remains absolute and may rebase only within its current target.
3. Router currentness comes from the router capability, never store supplements. Only an accepted router commit writes route supplements.
4. Server write, projection acceptance, and route commit are separate outcomes; later failure cannot undo or report failure as success for an earlier fact.
5. Exact transitions never rebase. A failed route CAS does not undo an already committed resource write.
6. Reconciliation validates external route state, but neither navigates nor invents command success.
7. Rejection, replacement, cleanup, and unmount leave no pending intent or operation-owned listener.
8. Equal canonical revision implies equal normalized entries; durable-layout, repo-target-projection, overlay, and provider-only changes share one monotonic epoch clock.
9. Runtime close clears only its epoch overlay/index/clock. Durable layout survives the next epoch and server restart.
10. Route-only destination requests never wait behind a target mutation. Busy admission rejects without creating a navigation generation or another deferred intent.

## Required concurrency tests

| Sequence                                            | Result                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| Absolute A→B, then A→C before B settles             | C rebases within the target and finishes final; B may be superseded          |
| Relative next, next across `[A,B,C]`                | A→B→C; neither step is superseded                                            |
| Relative move queued behind open/active-close       | resolve from the post-operation route and projection                         |
| Route-only destination arrives during target write  | reject immediately; the accepted write and route generation remain unchanged |
| Router leaves the repo/branch while a command waits | reject with no navigation                                                    |
| Runtime/worktree is replaced while a command waits  | reject with no effect on the replacement                                     |
| Close write commits, then source CAS fails          | resource stays closed; the stale URL renders an empty pane                   |
| One of two windows releases a shared runtime        | sibling remains current                                                      |
| Recovery resets projection scopes                   | cancel old work; keep effect-owned listeners installed                       |

Queue tests must block between capture and execution. Router substitutes must track the observed route and enforce production preconditions. Assert command outcomes, final route, and zero effects on rejected targets; never encode a partial side effect as success.
