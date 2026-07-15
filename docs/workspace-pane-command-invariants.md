# Workspace Pane Command Invariants

Normative rules for workspace-pane commands, queues, routing, and tests.

## Ownership

- `WorkspacePaneLayoutRepository`: the only restart-durable static target and tab order.
- `WorkspacePaneEpochOverlay`: runtime placement constraints, physical reverse indexes, active repo projections, and its overlay revision.
- Repo projection: authoritative valid target identities and current worktree branch metadata, captured as an explicit read-only command/snapshot input rather than cached by the aggregate.
- `WorkspacePaneLayoutAggregate`: the canonical epoch projection clock derived from durable layout, repo target projection, overlay revision, and provider revisions.
- Runtime providers: the only live runtime-session membership authority.
- Server aggregate: layout commands, target repair/retirement, and deterministic canonical projection.
- Router: visible repo, branch, and pane route.
- React Query: canonical-tab projection. Repo store: restorable preferences, selection, and opener facts.
- Action queue: ordering only. Presentation token: permission to publish one navigation result only.

Never mirror router currentness or infer server runtime validity from client timing.

Canonical tabs are a one-way projection:

```text
durable static layout + authoritative repo target projection + epoch placement/index state + provider snapshots
-> versioned WorkspacePaneTabsSnapshot
-> React Query projection
```

The overlay may retain same-epoch placement hints for a temporarily missing runtime session, but it never creates membership or copies durable static order. A missing durable target may synthesize `status`; an explicitly persisted target with `tabs: []` remains empty.

## Server Commit Order

Durable commands obey this lock order:

```text
physical worktree permit
-> repoRoot layout queue
-> settings mutation queue inside the repository adapter
-> synchronous epoch overlay commit
```

The aggregate owns the `repoRoot` queue and canonical epoch projection clock. The repository CAS commits before overlay/revision state. A conflict re-reads current layout and re-plans the original intent. Persistence failure commits no overlay. Invalid persisted targets are filtered by the authoritative repo projection even when repair persistence fails. Provider snapshots are sampled again after persistence before returning the canonical snapshot.

Target repair and retirement use the same aggregate boundary. Repair validates membership and filters invalid target keys from the settings transaction's current layout in one atomic write, preserving valid siblings without partial commits. The epoch physical index retains only a lightweight admission lease for each target: identity-queue admission plus the runtime-epoch signal. Current operations and removal require a separate execution capability and validate the physical object; stale-index cleanup uses the lease so a deleted path can still be reconciled safely. Physical removal retires each stable repo/target once, then clears every affected live overlay. Git success followed by layout persistence failure reports `repositoryStateChanged: true`; physical deletion is never described as rolled back.

## Commands

| Class | Capture | Execute/commit |
| --- | --- | --- |
| Absolute current-target: identity/index/open | intent and presentation token before queue | resolve from current projection; latest absolute intent wins; router must remain on the target |
| Relative current-target: next/previous | `direction` before queue | resolve route, projection, adjacent tab, and token at execution; every queued step runs |
| Exact transition: active close-back | source, destination, opener, and token before write | never rebase; commit only while router still equals the source |
| Absolute destination | destination and target lease before queue | independent of source route; destination lease must remain current |
| Resource command: create/close/open membership | write input and operation facts | server returns canonical projection; client accepts only the matching runtime, then follows the route class above |
| Recovery/reconciliation | canonical server/runtime snapshot | converge after server state; never repair or reclassify a user command |

## Invariants

1. Every queued command keeps its admission lease: `repoRuntimeId`, branch, and worktree. It cannot cross an epoch or worktree replacement.
2. Relative intent remains relative until execution and runs once in queue order. Absolute intent remains absolute and may rebase only within its current target.
3. Router currentness comes from the router capability, never store supplements. Only an accepted router commit writes route supplements.
4. Server write, projection acceptance, and route commit are separate outcomes; later failure cannot undo or report failure as success for an earlier fact.
5. Exact transitions never rebase. A failed route CAS does not undo an already committed resource write.
6. Reconciliation may canonicalize external stale state, but cannot invent command success.
7. Rejection, replacement, cleanup, and unmount leave no pending intent or operation-owned listener.
8. Equal canonical revision implies equal normalized entries; durable-layout, repo-target-projection, overlay, and provider-only changes share one monotonic epoch clock.
9. Runtime close clears only its epoch overlay/index/clock. Durable layout survives the next epoch and server restart.

## Required concurrency tests

| Sequence | Result |
| --- | --- |
| Absolute A→B, then A→C before B settles | C rebases within the target and finishes final; B may be superseded |
| Relative next, next across `[A,B,C]` | A→B→C; neither step is superseded |
| Relative move queued behind open/active-close | resolve from the post-operation route and projection |
| Router leaves the repo/branch while a command waits | reject with no navigation |
| Runtime/worktree is replaced while a command waits | reject with no effect on the replacement |
| Close write commits, then source CAS fails | resource stays closed; reconciliation may fix the URL |
| One of two windows releases a shared runtime | sibling remains current |
| Recovery resets projection scopes | cancel old work; keep effect-owned listeners installed |

Queue tests must block between capture and execution. Router substitutes must track the observed route and enforce production preconditions. Assert command outcomes, final route, and zero effects on rejected targets; never encode a partial side effect as success.
