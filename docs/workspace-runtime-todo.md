# Workspace Runtime TODO

This document tracks the follow-up architecture work after the workspace pane view refactor in PR #68.

The current implementation already gives the renderer a generic `WorkspacePaneView` model, but the server-side authority still lives inside the terminal runtime. That is acceptable for the current PR, but the next architectural step is to move this ownership into a workspace runtime so future views like Cloud Code chat, file tree, and embedded browser do not grow out of terminal-specific ownership.

## Target Shape

- Introduce a server-side workspace pane runtime or registry as the authority for:
  - open workspace pane views
  - view identity
  - per-worktree view order
  - close/reorder validation
  - view lifecycle events
- Keep terminal process/session lifecycle inside terminal runtime.
- Treat terminal as one workspace pane view provider, not as the owner of the pane model.
- Keep renderer UI generic: `WorkspacePaneViewStrip` should continue to render one view list regardless of view type.
- Keep the model simple until more non-terminal view types are real.

## Phase 1: Extract Server State Ownership

- [ ] Add a focused server module, likely under `src/server/workspace-pane/`.
- [ ] Move static workspace pane view state out of `TerminalSessionManager`.
- [ ] Move common reorder validation out of `TerminalSessionManager`.
- [ ] Define a server-owned view record shape that can represent:
  - `terminal`
  - `status`
  - `changes`
  - future `cloud-code-chat`
  - future `file-tree`
  - future `browser`
- [ ] Keep the terminal runtime responsible only for terminal sessions, PTY ownership, snapshots, and terminal attach/restart/close behavior.
- [ ] Have terminal session create/close register or unregister terminal view records through the workspace pane runtime.

## Phase 2: Clean Server API Boundaries

- [ ] Rename socket actions away from terminal-specific ownership where appropriate.
  - Current: terminal socket carries `list-views`, `open-view`, `close-view`, `reorder-views`.
  - Target: workspace pane runtime owns these actions, even if they are still transported through the existing socket temporarily.
- [ ] Decide whether to introduce a separate workspace pane websocket/channel now or defer it.
- [ ] Keep transport migration separate from model extraction unless the coupling becomes confusing.
- [ ] Emit a workspace-pane-specific changed event instead of relying only on `sessions-changed`.
- [ ] Keep backward compatibility for the existing renderer bridge during migration.

## Phase 3: Renderer Runtime Boundary

- [ ] Split workspace pane view reconciliation from `TerminalSessionRegistry`.
- [ ] Keep terminal session hydration and xterm lifecycle in the terminal registry.
- [ ] Introduce a renderer-side workspace pane store/registry that owns:
  - static view summaries
  - terminal view summaries
  - selected/opened view state
  - optimistic open/close/reorder rollback
- [ ] Have terminal registry publish terminal view summaries into the workspace pane registry.
- [ ] Keep `WorkspacePaneViewStrip` unaware of terminal internals.

## Phase 4: Persistence Model

- [ ] Make server runtime the source of truth for view order and opened views.
- [ ] Keep renderer session state limited to user preference, such as selected workspace pane view type.
- [ ] Decide whether server view state must survive app/server restart.
- [ ] If restart persistence is required, store opened views and order in a server-owned persistence path, not in renderer UI state.
- [ ] Keep legacy `detailTabByRepo` as read-only migration until it can be removed safely.

## Phase 5: Future View Providers

- [ ] Define a small provider interface for non-terminal views:
  - create/open
  - close
  - title/label metadata
  - tooltip metadata
  - optional badge/state metadata
- [ ] Add Cloud Code chat as the first non-terminal provider only after the runtime boundary is clear.
- [ ] Add file tree and embedded browser as separate providers, not as terminal-specific special cases.
- [ ] Keep provider-specific business logic outside the shared workspace pane view strip.

## Cleanup Criteria

- [ ] `TerminalSessionManager` no longer stores static workspace pane views.
- [ ] `TerminalSessionRegistry` no longer owns static workspace pane view lists.
- [ ] View ordering code is not duplicated between terminal and workspace pane modules.
- [ ] Server APIs and event names make sense without knowing terminal exists.
- [ ] Adding a new view type requires adding a provider and renderer content component, not editing terminal session lifecycle code.
- [ ] Architecture checks and existing terminal tests remain green.
