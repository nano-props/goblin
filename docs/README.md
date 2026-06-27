# Goblin Design Notes

Use these docs for app-level product and architecture decisions:

- `ui-conventions.md`: UI and copy rules
- `arch.md`: app shell and process control
- `ssh-remote.md`: SSH remote repository backend design
- `layering.md`: feature layering rules
- `state-sync.md`: state control and sync model
- `client-model.md`: client model
- `testing.md`: testing strategy
- `realtime.md`: realtime rules
- `g-command.md`: `g` shell command architecture (registry, control vs. data plane, error envelope)
- `terminology.md`: canonical naming reference for subsystems, components, and state classes
- `terminal.md`: terminal system design
- `terminal-session-lifecycle.md`: terminal session lifecycle correctness (first-frame protocol, durable close, `session-closed` broadcast, empty-state CTA)
- `terminal-roadmap.md`: terminal refactor roadmap
- `terminal-target-model.md`: terminal target lifecycle and control model
- `terminal-takeover.md`: terminal takeover — who controls the cursor (single-user, multi-device, intent-recent, user-scoped)
