# Goblin Design Notes

Use these docs for app-level product and architecture decisions:

- `ui-conventions.md`: UI and copy rules
- `arch.md`: app shell and process control
- `ssh-remote.md`: SSH remote repository backend design
- `layering.md`: feature layering rules
- `state-sync.md`: state control and sync model
- `startup.md`: primary window startup, restore, routing, and persistence gates
- `client-model.md`: client model
- `testing.md`: testing strategy
- `realtime.md`: realtime rules
- `repo-runtime-membership.md`: repo runtime identity and window-local membership ownership
- `g-command.md`: `g` shell command architecture (registry, control vs. data plane, error envelope)
- `terminology.md`: canonical naming reference for subsystems, components, and state classes
- `transient-surfaces.md`: transient hover/proximity surfaces and descendant floating-surface pinning
- `terminal.md`: terminal system design
- `terminal-session-lifecycle.md`: terminal session lifecycle correctness (first-frame protocol, durable close, `session-closed` broadcast, empty-state CTA)
- `terminal-roadmap.md`: terminal refactor roadmap
- `terminal-target-model.md`: terminal target lifecycle and control model
- `terminal-ephemeral-xterm.md`: current inactive-terminal xterm lifetime model
- `terminal-takeover.md`: terminal takeover — who controls the cursor (single-user, multi-device, intent-recent, user-scoped)
- `filetree.md`: worktree-scoped file tree view (server-first, read-only v1)
- `workspace-tab-opener.md`: workspace pane tab opener model — open-after-opener vs. append, close-back-to-opener
- `workspace-pane-command-invariants.md`: command ownership, queue/token/CAS semantics, and required concurrency cases
