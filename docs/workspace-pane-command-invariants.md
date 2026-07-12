# Workspace Pane Command Invariants

Use this document when changing workspace-pane commands, queues, routing, or tests.

## Owners

- The server owns runtime resources, canonical tab membership, layout revision, and `repoRuntimeId` validity.
- The router owns the current visible repo, branch, and pane route.
- React Query owns the client projection of canonical server tabs.
- The repo store owns restorable supplements such as preferred tab, selected terminal, and opener facts.
- The action queue owns ordering only. It is not a route, runtime, or tab-state authority.
- A presentation token owns permission to publish one navigation result. It does not identify a runtime or resolve a relative intent.

No production module may mirror router currentness or infer server runtime validity from client timing.

## Command classes

| Class | Examples | Intent captured | Destination resolved | Presentation token | Route precondition |
| --- | --- | --- | --- | --- | --- |
| Absolute current-target | select tab identity/index, open a known tab | before queue | target identity/index is resolved from the current projection when the task executes | before queue; latest absolute intent wins | current router route must still belong to the queued repo/branch target |
| Relative current-target | next/previous tab | `direction` before queue | adjacent tab is resolved from router current route and the latest projection when the task executes | when the task executes; every queued step runs | current router route must still belong to the queued repo/branch target |
| Exact planned transition | active close-back | closing identity, exact source, next route, opener | before the runtime write | owned by the planned transition | router route must still equal the planned source |
| Absolute destination | show a tab in another resolved repo/branch | destination route and target lease | before queue | before queue; latest destination wins | no source-route dependency; destination runtime/worktree lease must remain current |
| Resource command | create/close runtime tab, open static membership | server write input and operation facts | server returns canonical projection; navigation follows its command class | depends on current vs destination presentation | server validates runtime; client applies only a matching runtime projection |
| Recovery/reconciliation | realtime recovery, route reconciliation | canonical server/runtime snapshot | after server convergence | none | never repairs or reclassifies a user command |

## Invariants

1. A queued command carries the `repoRuntimeId`, branch, and worktree lease captured at admission. It must not execute against a replacement epoch or worktree.
2. Relative intent stays relative until execution. Do not store a precomputed adjacent identity outside the queue.
3. Absolute identity stays absolute. It may rebase from an earlier route within the same current workspace target, but it must not cross repo or branch boundaries.
4. Relative commands execute every admitted step in queue order. A later relative command must not supersede an earlier one before that earlier step runs.
5. Exact planned transitions do not rebase. If their source route changed, navigation is rejected while any already committed server write remains committed.
6. Router currentness is read from the router-owned navigation capability. Store preference and selected-session supplements are never substitutes.
7. Server mutation, canonical projection acceptance, and route completion are separate outcomes. Failure in a later phase must not rewrite an earlier committed fact.
8. Route supplements are written only by the navigation commit effect that the router accepts.
9. Reconciliation may canonicalize externally arrived stale state. It must not invent success for a failed or superseded command.
10. Queue cleanup, rejection, runtime replacement, and unmount must leave no pending route intent or operation-owned listener.

## Required concurrency cases

| Sequence | Required result |
| --- | --- |
| Absolute A→B then A→C before B settles | B may be superseded; C commits from the then-current route and is final |
| Relative next, next from A across `[A,B,C]` | both steps execute: A→B→C |
| Relative move queued behind open | open completes, then move resolves from the post-open route and tab projection |
| Relative move queued behind active close | close-back completes, then move resolves from that new route |
| External navigation leaves repo/branch while a command waits | waiting current-target command rejects without navigation |
| Runtime/worktree replacement while a command waits | waiting command rejects without server or route effects on the new target |
| Close write commits, then exact source CAS fails | resource remains closed; route reconciliation may later canonicalize the URL |
| Two windows share a repo runtime and one closes | only that client's membership is released; the sibling remains current |
| Realtime recovery resets projection scopes | old work is cancelled; effect-owned listeners remain installed |

## Test rules

- Queue tests must use a real blocker so intent capture and execution occur in different turns.
- Router tests must distinguish current route from destination route and assert that rejected preconditions do not call `navigate`.
- Test navigation substitutes must store observed current route and implement the same route precondition contract as production.
- Runtime replacement tests must change `repoRuntimeId` while work is queued and assert zero effects on the replacement target.
- Do not make a failing command test pass by changing the expected result to a partial side effect. Assert the final visible route and every command outcome.
