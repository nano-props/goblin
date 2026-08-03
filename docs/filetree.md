# Workspace File Tree

Use this document for the workspace-pane filesystem tree and its file actions.

## Purpose

- Give users a navigable view of a workspace root or Git worktree.
- Keep filesystem authority on the server for local and remote targets.
- Load large trees incrementally without turning tree state into application
  authority.
- Expose file actions through explicit capability and confirmation boundaries.

## Product boundaries

- The tree is a workspace-pane surface, not a general file manager.
- It does not own filesystem contents, Git state, workspace membership, or
  external-tool behavior.
- A target is the validated workspace or worktree execution root, not a branch
  name or a client-supplied native path.
- The server enumerates files and validates actions. Clients render returned
  nodes and send user intent; they never read the filesystem directly.

## Read model

- Directory children are loaded lazily. Expanding one directory reads that
  directory; it does not require a full recursive snapshot.
- Node identity is the normalized relative path within the validated root.
- `.git` internals are never exposed as ordinary tree content.
- Git-worktree reads respect ignored-path visibility while preserving tracked
  content. Plain workspace reads reflect the workspace filesystem.
- Results are bounded and explicitly report truncation. Truncation, cancellation,
  and read failure are distinct from an empty directory.
- Server invalidation causes affected reads to converge. The tree does not add a
  parallel polling authority.
- Showing the file-tree surface starts or joins a read for the root and
  reachable restored directories while preserving the last accepted projection
  during refresh.
- These independent reads form a best-effort projection, not an atomic snapshot
  for one surface activation. Out-of-band changes converge on a later read.

## Client state

- Expansion, selection, and scroll position are client-owned presentation
  preferences and may be restored across sessions. Loading and action state are
  ephemeral.
- A remembered expansion participates in restored reads and visible read status
  only while all of its ancestor directories are expanded.
- Each filesystem execution target owns one read lifecycle. Changing the target
  replaces that owner; results from the previous target remain isolated in its
  query cache and cannot enter the new projection.
- Restored presentation state never becomes filesystem or workspace authority.
- Replacing or invalidating a directory result must not allow a stale response
  to overwrite the newer target projection.
- A failed refresh keeps the last accepted tree visible, marks it as stale, and
  offers an explicit retry. An initial read failure does not fabricate an empty
  tree.

## File actions

- Selection is local and has no filesystem side effect.
- Activation delegates to a capability that can view or open the selected file.
- Destructive actions require an explicit confirmation boundary and
  server-authoritative target validation.
- Actions do not optimistically remove tree entries. Success invalidates the
  affected projection. Ordinary failure remains directly retryable; an
  indeterminate result that may have changed authoritative state triggers
  hydration instead of pretending the old tree is final.
- The tree does not infer action availability from filenames or client-local
  filesystem assumptions.

## Invariants

- A relative path cannot escape its validated root.
- Client state never authorizes a filesystem operation.
- Empty, truncated, cancelled, and failed reads remain distinguishable.
- Local and remote backends preserve the same product-level tree and action
  semantics even when their execution mechanisms differ.
- Tree interaction must not create a second repository or workspace authority.
