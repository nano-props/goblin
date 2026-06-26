# Worktree Bootstrap

Use this doc for repo-configured file materialization and post-create setup when creating a worktree.

## Goal

- Let a repo declare which local-only paths should appear in a new worktree.
- Let a repo declare a single setup command to run after the worktree is created.
- Keep the config explicit, small, and predictable.
- Support `copy`, `symlink`, `hardlink`, `exclude`, and `setup`.

## Config

Use `goblin.toml` at the repo root.

Run `g init` from the repo root to create a commented empty file.

```toml
[worktree]
copy = [
  ".env.local",
  ".vscode/settings.json",
]

symlink = [
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

setup = "bun install"
```

## Rules

- Read `goblin.toml` from the repo root of the worktree that initiated create.
- Resolve all paths and globs relative to that same repo root.
- Run bootstrap for local worktree creation only.
- After `git worktree add`, expand `copy` / `symlink` / `hardlink`, then subtract `exclude`, then materialize into the new worktree.
- After materialization, run `setup` once in the new worktree root if it is defined.

## Semantics

- `copy`: create an independent file or directory tree.
- `symlink`: create a symbolic link back to the source path.
- `hardlink`: create a hard link for files only; directory hardlinks are invalid.
- `exclude`: removes matches from all materialization sets.
- `setup`: a single shell command string, executed once in the new worktree root after materialization. It runs through the user's interactive login shell (`$SHELL -il -c`) so tools available in the normal terminal PATH work without absolute paths.

## Constraints

- `.git` paths are reserved.
- Paths are repo-relative.
- Existing destination paths are left unchanged; bootstrap fails instead of overwriting.
- Missing source paths are skipped and reported.
- If one concrete path matches more than one of `copy`, `symlink`, or `hardlink`, fail the bootstrap as a config error.
- Bootstrap failure does not roll back files already created in the new worktree.
- `setup` runs exactly as written.

## v1 bias

- If `goblin.toml` is absent, create behaves exactly as today.
- Keep v1 to `copy`, `symlink`, `hardlink`, `exclude`, and `setup`.
- `setup` is a single string; multi-step workflows should use shell composition (`&&`, `;`).
- Do not infer rules from untracked files.
- Do not turn worktree create into a general sync engine.
- Let `setup` handle package-manager-owned trees such as `node_modules`.
