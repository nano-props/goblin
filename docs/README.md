# Goblin Design Notes

Use these docs for app-level product and architecture decisions:

- `ui-conventions.md`: UI and copy rules
- `workspaces.md`: canonical workspace identity, capabilities, refresh, and pane targets
- `arch.md`: app shell and process control
- `ssh-remote.md`: SSH remote workspace backend design
- `layering.md`: feature layering rules
- `state-sync.md`: state control and sync model
- `startup.md`: primary window startup, restore, routing, and persistence gates
- `client-model.md`: client model
- `testing.md`: testing strategy
- `realtime.md`: realtime rules
- `workspace-runtime-membership.md`: durable workspace membership, runtime identity, and client lease ownership
- `g-command.md`: `g` shell command architecture (registry, control vs. data plane, error envelope)
- `terminology.md`: canonical naming reference for subsystems, components, and state classes
- `transient-surfaces.md`: transient hover/proximity surfaces and descendant floating-surface pinning
- `terminal.md`: terminal system design
- `terminal-session-lifecycle.md`: terminal session lifecycle correctness (fresh-stream/recovery-frame protocol, durable close, `session-closed` broadcast, empty-state CTA)
- `terminal-roadmap.md`: terminal refactor roadmap
- `terminal-target-model.md`: terminal target lifecycle and control model
- `terminal-ephemeral-xterm.md`: current inactive-terminal xterm lifetime model
- `terminal-takeover.md`: terminal takeover — who controls the cursor (single-user, multi-device, intent-recent, user-scoped)
- `filetree.md`: worktree-scoped file tree view (server-first, read-only v1)
- `workspace-tab-opener.md`: workspace pane tab opener model — open-after-opener vs. append, close-back-to-opener
- `workspace-pane-command-invariants.md`: command ownership, queue/token/CAS semantics, and required concurrency cases
