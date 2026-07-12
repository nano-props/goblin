# Workspace Pane Command Invariants

Normative rules for workspace-pane commands, queues, routing, and tests.

## Ownership

- Server: runtime resources, canonical tabs/layout revision, and `repoRuntimeId` validity.
- Router: visible repo, branch, and pane route.
- React Query: canonical-tab projection. Repo store: restorable preferences, selection, and opener facts.
- Action queue: ordering only. Presentation token: permission to publish one navigation result only.

Never mirror router currentness or infer server runtime validity from client timing.

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
