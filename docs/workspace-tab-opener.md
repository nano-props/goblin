# Workspace tab opener

Each workspace pane tab may carry an **opener** — the tab that was active when the user triggered the action that opened it. Opener drives two things: where the new tab lands, and which tab gets focus when this one is closed.

## Open

The strip splits based on **how** the action was triggered:

- **From inside a tab** (links in Status, Files tree double-click, `g` commands from a terminal, etc.) → new tab lands **immediately to the right of the opener**.
- **From a generic entry** (`+` button, branch navigator, command palette "Show …", empty-state CTA) → new tab **appends to the end**. Opener is still recorded — it's the tab active at click time — but the new tab does not displace anything.

The opener is captured at click time and does not change afterwards.
Existing tabs' opener records never participate in a later tab's placement.
They are close-back facts, not sibling-group or insertion-chain metadata.
Runtime create commands should capture the opener at the user-action boundary,
then record the new tab's opener as soon as the server/projection has minted
the child tab identity and before routing to the child tab. The route should
then be a pure consequence of the completed create operation, not a route
first followed by opener repair.

Opener is an operation fact, not a post-render repair. Record operation facts
in the sequential workflow that creates or opens the tab. If the operation
entry cannot prove the branch target, worktree, runtime projection, or route
navigation boundary is usable, fail before the write instead of creating a tab
and trying to patch opener state afterwards.

Workspace-pane tab-list writes keep their concurrency at the operation
boundary. `open-static` may run concurrently because the server returns the
canonical merged tab list. Operations that remove or reorder tabs
(`close-static`, `reorder`, and full tab-list commits) block tab interaction for
that target until the server commit resolves; if the commit fails, no route
navigation is produced.

Opener is not a focus guard. It should not decide whether a late async create
result may navigate. Async create flows should serialize through the
operation entry point using projection-owned pending state; opener only
answers insertion and close-back behavior.

Workspace-pane navigation must return an explicit accepted/rejected result.
Commands that create, close, select, or restore pane tabs must consume that
result at the operation boundary instead of assuming that a fire-and-forget
route call succeeded. Do not defer opener recording until route effects run,
and do not repair failed navigation later from an effect.

## Route context

Workspace pane routes are part of the operation input. Route-backed command,
open, close, and opener-capture paths must pass the current
`workspacePaneRoute` explicitly. `undefined` is only for entry points that are
not inside a workspace pane route and intentionally use persisted preference;
it should be spelled at the call site, not produced by omitting an option.

This keeps a bare branch route (`workspacePaneRoute: null`) as an empty pane
instead of silently falling back to a persisted active tab.

## Close

When closing a tab with an opener:

1. If the opener is still in the strip, focus returns to it.
2. Otherwise, focus falls back to the right neighbour.

Close-back is planned before the close write starts, but navigation happens
only after the close succeeds. The command must read the current tab model,
resolve the opener/right-neighbour target, start the close, await its result,
clear the opener for the closed tab, and then navigate to the precomputed
target. Do not navigate before the close to mask a pending write, and do not
use an effect or background observer to repair focus after the close. If the
close fails, keep the user on the current route and surface the failure through
the owning command path.

## Edge cases

- **Opener closed mid-flight** → open path appends to end; close path uses the right neighbour.
- **Opener in a different branch** → opener is only used if it actually exists in the target strip; otherwise falls back to append / right neighbour.
- **No active tab** (cold start, empty strip) → opener is null; new tab is appended.
