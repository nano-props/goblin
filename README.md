# Goblin

Goblin is a desktop Git branch manager for keeping multiple repositories and worktrees organized.

## Core features

- Open multiple repositories in tabs and restore the previous session.
- Browse branches, commit logs, and working tree status in one place.
- Fetch and refresh repository state, with remote sync and PR context.
- Checkout, pull, push, open GitHub links, and manage branches from the branch list.
- Create or open linked worktrees, including quick handoff to terminal or VS Code.
- Navigate quickly with keyboard shortcuts, themes, and multilingual UI.

## Build & install (macOS)

```sh
./install.sh
```

Builds a host-architecture `.app` and installs it to `~/Applications`.

## Develop

```sh
bun install
bun run dev
```
