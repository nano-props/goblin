# Goblin

One workspace for Git branches and worktrees.

## Requirements

- Bun
- Node.js 24+

## Core features

- Headless terminals. Server-backed.
- Compact on small screens.
- Local and SSH repos.
- Built for branch flow.

## Build & install

```sh
./install.ts                # mac / linux
bun install.ts              # windows
bun run install:app         # any platform
```

Installs a host-architecture `.app` to `~/Applications` (mac) or
`%LOCALAPPDATA%\Programs\Goblin[-arm64]` (win). See `-h` for flags.

## Run server mode

```sh
./serve.sh
```

Builds the web UI, then starts server mode. Default: `http://127.0.0.1:32100`.

Use `--host` or `--port` to override the listen address:

```sh
./serve.sh --host 127.0.0.1 --port 32100
```

## Develop

```sh
bun install
bun run dev
```
