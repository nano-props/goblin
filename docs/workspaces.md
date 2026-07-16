# Workspaces and Git capabilities

Goblin's top-level object is a directory-backed workspace. A workspace is identified by one canonical, transport-aware locator:

- `goblin+file:///absolute/path`
- `goblin+ssh://ssh-alias/absolute/path`

Only `src/shared/workspace-locator.ts` parses or formats these identifiers. OS folder pickers may return native paths, but the open boundary converts them immediately. Persisted membership, procedure payloads, and runtime projections use locators; native paths exist only at filesystem, process, editor, terminal, and SSH command boundaries.

Git is optional runtime enrichment. The server enables Git only when Git's resolved root is the resolved workspace root. A repository in a parent directory does not grant Git capabilities to the opened folder. Missing Git, malformed metadata, and failed Git enrichment do not prevent a readable directory from opening.

Workspace capabilities are server-owned and are not persisted. They are probed on open, restore, or an explicit Refresh Workspace command. Refresh is serialized by runtime ID. An inconclusive refresh preserves the last committed capability and resources; a conclusive Git-to-plain transition removes Git-scoped resources without changing workspace or runtime identity.

Pane targets have two contracts:

- Restorable targets contain only `workspace`, `git-branch`, or a `git-worktree` canonical locator. Their containing workspace owns the workspace ID; runtime IDs are never persisted.
- Runtime targets bind the containing workspace ID and current server-issued runtime ID after validation.

Files and terminals may use workspace scope. Status, changes, history, pull requests, and worktree operations require Git capability. Enabling Git exposes those entry points but does not create tabs or navigate automatically.
