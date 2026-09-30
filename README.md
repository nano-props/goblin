# Goblin

One workspace for Git branches and worktrees.

## Requirements

- Linux or macOS
- Bun 1.4.2+
- Git; SSH for remote workspaces
- Node.js 24.15+ (LTS) or 26+ for development checks and tests

## Core features

- Headless terminals. Server-backed.
- Compact on small screens.
- Local and SSH repos.
- Built for branch flow.

## Start

```sh
bun install
bun run start
```

Open `http://127.0.0.1:32100`. Sign in with the printed token.

Or run from source:

```sh
bun run build:web
bun run start:server
```

## Build

```sh
bun run build
./dist/goblin serve
```

One binary. Runtime and web assets included. Built for your OS and architecture.
See `./dist/goblin -h` for options.

## Develop

```sh
bun run dev
```

Open `http://127.0.0.1:5173`. Reloads as you work.

## Verify

```sh
bun run typecheck
bun run test
```

See [the documentation index](docs/README.md) for details.
