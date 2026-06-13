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

### macOS

```sh
./install.sh
```

Builds a host-architecture `.app` and installs it to `~/Applications`.

### Windows

```powershell
.\install.ps1
```

Builds an unpacked Windows app directory and installs it to
`%LOCALAPPDATA%\Programs\Goblin[-arm64]`. The PowerShell script is the
direct counterpart of `install.sh` — same flags, same env vars, same
defaults.

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
