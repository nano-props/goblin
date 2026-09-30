# Goblin

One workspace for Git branches and worktrees, served to your browser.

## Requirements

- Linux or macOS for the server (Windows is not supported)
- Bun 1.4.2+ for source development and builds
- Node.js 24.15+ (LTS) or 26+ for development checks and Vitest
- Git; SSH for remote workspaces

## Core features

- Server-backed terminals and persistent workspace tabs
- Local and SSH workspaces
- Git branches and worktrees
- Responsive browser UI

## Start

```sh
bun install
bun run start
```

This builds the web UI and server, then starts the executable at `http://127.0.0.1:32100`.
On macOS and Linux, `./serve.sh` runs the same build and accepts server options:

```sh
./serve.sh --host 127.0.0.1 --port 32100
```

The canonical process entry is `src/server/main.ts`; it dispatches server startup,
browser opening, the internal PTY worker, and the `g` command.

Build and run the standalone executable:

```sh
bun run build
./dist/goblin serve --host 127.0.0.1 --port 32100
```

The distributable is the single file `dist/goblin`, built for the current OS and
CPU architecture. Copy it to another directory or compatible machine and run
`goblin serve`: no Bun, Node.js, `node_modules`, or separate web assets are needed.
The binary embeds the Bun runtime, browser assets, server, PTY worker, SSH
scripts, and `g` command. Git, a local shell, and SSH (for remote workspaces)
remain system prerequisites. Application data is stored outside the binary.
The build also leaves `dist/web` for source development; it is not needed for
distribution.

Running `goblin` with no arguments, `goblin --help`, or `goblin -h` prints help
without starting a server. `goblin --version` / `goblin -v` prints the version.
Use `goblin serve --help` and `goblin open --help` for command usage.

Once the server is running, open a directory as a workspace in your browser:

```sh
goblin open .
goblin open /path/to/project --port 32100
```

`goblin open` without a directory uses the current directory. It opens
`/open?path=<encoded-directory>` in the default browser. The CLI only constructs
the URL and launches the browser;
it does not contact the server, read tokens, or start a server.

The browser owns authentication and directory opening. An already signed-in
browser opens the directory automatically. Otherwise, sign in at the normal
login gate and the page continues afterward. After workspace restore completes,
the page uses the normal workspace-opening flow and replaces the command URL
with the workspace URL. Opening failures remain visible with an explicit retry;
a navigation failure retries navigation without reopening the workspace.

Both `serve` and `open` accept `--host` / `--port` and use `GOBLIN_SERVER_HOST` /
`GOBLIN_SERVER_PORT` as defaults. Pass the same address settings to both.
Directories are on the server machine; relative inputs are resolved against the
CLI's working directory. The URL accepts one absolute path of up to 4096
characters. Linux browser opening requires `xdg-open`; macOS uses `open`.
If browser launching fails, the command prints the URL for manual opening.

On first start the server writes a 25-character token to `<dataDir>/server-token`
and prints it. Open the browser URL and paste the token at the login gate.
Use `--data-dir /path/to/data` to choose a data directory, or `--token` to supply
a token explicitly. Bind to `--host 0.0.0.0` for trusted LAN access; the server
prints LAN URLs and QR codes. Use an HTTPS reverse proxy outside a trusted network.

To rotate a generated token, stop the server, delete `<dataDir>/server-token`,
then restart. In a source checkout, the reset helper removes that file:

```sh
bun run reset-token
bun run reset-token -- --data-dir /path/to/data
```

Tokens supplied with `--token` are not file-backed and are unaffected.

## Develop

```sh
bun run dev
```

Open `http://127.0.0.1:5173` and use the server's printed token. Vite provides
frontend hot updates and proxies `/api` and `/ws` to the Bun server. Bun watch
mode restarts the backend when its imported source changes; restarting ends its
live terminals. `GOBLIN_WEB_DEV_HOST` / `GOBLIN_WEB_DEV_PORT` configure Vite;
`GOBLIN_SERVER_HOST` / `GOBLIN_SERVER_PORT` configure the backend.

`bun run start:server` starts the backend directly from source. Run
`bun run build:web` first when serving the UI without Vite.

## Verify

```sh
bun run typecheck
bun run test
```

See [the documentation index](docs/README.md) for architecture and feature contracts.
