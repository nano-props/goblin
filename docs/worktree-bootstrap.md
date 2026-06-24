# Worktree Bootstrap

Use this doc for repo-configured file materialization when creating a worktree.

## Goal

- Let a repo declare which local-only paths should appear in a new worktree.
- Keep the config explicit, small, and safe.
- Support `copy`, `symlink`, and `hardlink`.

## Config

Use `goblin.toml` at the repo root.

```toml
[worktree]
copy = [
  ".env.local",
  ".vscode/settings.json",
]

symlink = [
  "node_modules",
  "config/*.json",
]

hardlink = [
  "build/cache.db",
  "*.local",
]

exclude = [
  "*.log",
  "*.tmp",
]
```

## Rules

- Read `goblin.toml` from the repo root of the worktree that initiated create.
- Resolve all paths and globs relative to that same repo root.
- After `git worktree add`, expand `copy` / `symlink` / `hardlink`, then subtract `exclude`, then materialize into the new worktree.

## Semantics

- `copy`: create an independent file or directory tree.
- `symlink`: create a symbolic link back to the source path.
- `hardlink`: create a hard link for files only; directory hardlinks are invalid.
- `exclude`: removes matches from all materialization sets.

## Safety

- Never touch `.git` or `.git/**`.
- Never allow paths to escape the repo root.
- Never overwrite an existing destination path.
- Missing source paths are skipped and reported.
- If one concrete path matches more than one of `copy`, `symlink`, or `hardlink`, fail the bootstrap as a config error.

## v1 bias

- If `goblin.toml` is absent, create behaves exactly as today.
- Keep v1 to `copy`, `symlink`, `hardlink`, and `exclude`.
- Do not infer rules from untracked files.
- Do not turn worktree create into a general sync engine.

