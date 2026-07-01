# Filetree

The worktree-scoped file tree is one of the self-contained vertical slices that
make up the application, alongside the repository views, settings, terminal,
and remote features (see `docs/layering.md`). It exists to give the user a
navigable view of what is currently checked out, without duplicating state the
server already owns.

This document is intentionally directional. The wire shape, the exact list of
stable entry points, and the precise gating rules belong with the code; treat
them as read-through artifacts of the source rather than a contract enforced
from here. When the implementation changes, this file should be re-read for
direction, not for facts.

## What it is

- A tree view of a single worktree's tracked files, presented as a peer of the
  existing workspace tabs.
- A read window into the worktree. The view never mutates the working copy.
- A surface for invoking actions on a selected file — opening it for review,
  handing it to a tool that knows how to handle it, or asking for a
  destructive operation to be confirmed.

## What it is not

- Not a general file manager. No rename, no in-tree search, no multi-select,
  no drag/drop staging, no cross-worktree comparison.
- Not a content preview pane. The tree answers "where is this file"; a
  separate surface answers "what does it contain".
- Not a state holder. Expand / collapse / scroll / selection are ephemeral and
  scoped to the visible instance.

## Boundaries

- **Ownership**: the server is the source of truth. Clients render what the
  server returns; they do not enumerate the filesystem or query git directly.
- **Scope**: rooted at the worktree path, not at the checked-out branch. Move
  worktrees and the view follows; switch branches within one worktree and the
  view does not blink.
- **Layering**: sits inside the workspace pane as a static tab. It reuses the
  pane's mixed tab list, drag-reorder, keyboard navigation, and tooltip layer
  rather than inventing its own chrome.
- **State**: refresh is driven by the same invalidation channel the rest of
  the repository views use. Tree state does not leak into the global stores.

## Behaviour, at a glance

- Tracked files only. The list respects the repository's ignore rules, so
  what the user sees matches what they would `git ls-files`.
- The wire shape carries a `status` field per node, but v1's source layer
  hardcodes `clean` on every node — there is no `git status --porcelain`
  overlay yet. The broader `RepoTreeNodeStatus` union stays in the wire
  shape so a real overlay can land later without a breaking change. The
  remote walker uses `find`, so `.gitignore` filtering only applies on
  local worktrees.
- Empty directories are not represented; the tree is derived from the file
  list, not from a directory walk.
- Results are bounded. A very large or very deep worktree is allowed to return
  a truncated view rather than block the UI; the user should be told when
  this happens.

## Actions on a file

Selecting a file is always cheap; acting on one is opt-in. The view exposes
the actions it understands and leaves their execution to whoever wires it up,
so the tree itself stays a pure presentational component.

Directionally:

- Selection is local and free.
- Activation is delegated. The view advertises what the user did; the host
  decides whether that means "open", "send to terminal", "show in Finder",
  or nothing yet.
- Destructive actions are routed through an explicit confirmation path. The
  tree does not delete anything on its own.

## Constraints to keep in mind

- Read-only by contract. New behaviour should land as an explicit, confirmable
  action, not as a side effect of clicking.
- A transport-level abort is not the same as "the worktree is empty". Reads
  fail soft; a cancelled request must not look like a missing tree.
- The tree's refresh cost grows with the worktree, not with the number of
  tabs open. Keep query keys stable and let invalidation do the work; do not
  introduce a parallel polling channel.
- Persisted session state may carry a hint about whether the user wants this
  tab visible, and nothing else. Do not promote expand / collapse / scroll
  into persisted state.

## When this document and the code disagree

The code wins, and this file should be edited to match the new direction
rather than the other way around. Treat the sections above as a statement of
intent; treat the source files as the statement of fact.
