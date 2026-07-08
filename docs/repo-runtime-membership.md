# Repo Runtime Membership

Use this doc for repo open/close ownership.

## Decision

Repo runtime identity is server-owned. Repo workspace membership is
client-window-owned.

The server owns:

- the current `repoRuntimeId` for a `(userId, repoRoot)` runtime scope
- stale runtime rejection
- terminal/session cleanup when a repo runtime closes

The client window owns:

- which repos are shown in that window
- repo switcher order
- active repo
- restored workspace membership from `WorkspaceSessionState`

## Why

Different windows may reasonably show different repositories or focus a
different active repository. Making repo membership globally server-owned
would make a close in one window implicitly close the repo in another window,
which is not the current product model.

The server still needs to own runtime identity because repo-scoped terminal
and mutation paths must fail fast when a client targets a stale runtime.

## Data Flow

Open:

1. The client asks the server to open or resolve a repo runtime.
2. The server returns a canonical `repoRuntimeId`.
3. The client inserts or updates its window-local repo projection with that
   runtime id.

Close:

1. The client removes the repo from its window-local projection.
2. The client asks the server to close the matching `repoRuntimeId`.
3. If the server id is already stale, close is a no-op.
4. Server-side repo-runtime close events clean up runtime-scoped terminal
   resources.

Restore:

1. `WorkspaceSessionState.openRepoEntries` is boot-only restore input.
2. Restore reopens runtimes through the server before writing any
   repo projection.
3. After boot, session persistence records window-local membership for the
   next launch; it is not live runtime truth.

## Rules

- Do not add a global server-owned open repo list unless the product model
  changes to cross-window repo membership.
- Do not make `WorkspaceSessionState.openRepoEntries` a live synchronization
  source.
- Do not let the client mint or validate `repoRuntimeId` locally.
- Server routes that mutate repo-scoped runtime resources should validate the
  server-owned `repoRuntimeId` when the operation targets runtime state.
- Client cache keys for runtime-scoped resources should include
  `repoRuntimeId` where stale runtime separation matters.

## React Query Implication

React Query can own server data for a repo after the client window has opened
that repo, but React Query should not become a global open-repo membership
owner under the current product model.

Good candidates for React Query ownership:

- snapshot reads
- status reads
- pull request reads
- file tree reads
- workspace pane tabs reads

Keep in window-local state:

- repo order
- active repo
- branch selection
- workspace layout
- restored membership
