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

The cross-platform installer is `install.ts`. On macOS / Linux it's
executable via the shebang line, so `./install.ts` works directly. On
Windows the shebang is ignored, so use `bun install.ts` or
`bun run install:app`:

```sh
./install.ts                # mac / linux
bun install.ts              # windows (or any platform)
bun run install:app         # any platform, via package.json
```

Builds a host-architecture `.app` and installs it to `~/Applications` on
macOS, or an unpacked Windows app directory at
`%LOCALAPPDATA%\Programs\Goblin[-arm64]` on Windows. Same flags, same
env vars, same defaults on both platforms.

Useful flags:

- `--clean` — clear electron / electron-builder caches before building
- `--npmmirror` — route electron + electron-builder-binaries downloads
  through npmmirror (handy when GitHub is unreachable)
- `--mirror=URL` / `--binaries-mirror=URL` — override a single mirror
- `--full` — force-run typecheck + `@electron/rebuild` (the install
  mode defaults to the fast path that skips both)
- `-h` / `--help` — show all options

To build an NSIS installer (`Goblin-<version>-<arch>.exe`) instead of
the unpacked dir, run `bun run build` (no `install` positional). The
NSIS installer is what `scripts/publish.ts` ships to GitHub releases.

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
