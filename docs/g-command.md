# The `g` shell command

`g` is the shell-side handle into a running Goblin server. It runs inside the PTY sessions that Goblin itself spawns, and lets users do things from the command line that would otherwise require clicking through the UI.

This document describes the durable architecture, protocol boundary, and failure semantics. Individual command behaviour lives with its owning server application.

## Two planes

`g`'s design recognises two distinct kinds of operation:

- **Data plane** — read or modify server-owned state (repo info, settings, terminals). Every server-backed `g` command enters through `POST /api/terminal-command` with its command name and bounded payload. The server validates and dispatches the command through the same auth and error boundary used by the application.
- **Control plane** — relay view intents to subscribed clients over `/ws/notifications`, shared with invalidations. Receiver presence does not acknowledge execution.

The server sits between `g` and the client on the control plane. It does not interpret what an intent means; it envelopes and forwards. The client has one intent router that consumes intents from every supported source and applies them through the same handler chain.

## Why the server brokers intents

The server owns the CLI broker because:

- The server authenticates browser receivers and broadcasts view intents only
  to connections that explicitly subscribe to them.
- The client has one shared intent router. A new producer adds a subscription,
  not another routing model.
- HTTP and WS share the same auth and lifecycle. Adding a separate IPC channel would mean a third transport with its own auth model and lifecycle.

The cost is that the server knows about envelope shapes. The benefit is that the server doesn't — and never needs to — know what any specific intent does.

## Command registry

Each `g <subcommand>` is described by one registry entry:

- a name
- a one-line summary
- an optional usage hint
- a `run(ctx)` function

The CLI is reduced to `find by name → call run`. Each `run` receives a context with args, env, I/O, and a transport. Server-backed entries only forward a command envelope and present the returned output; argument semantics, authoritative reads, mutations, and result construction stay on the server. Purely local commands, such as creating a file in the shell's current directory, remain local because no server-owned state is involved.

Dispatch remains data-driven as the command set grows. Command groups may organize the registry, but they must not introduce a second dispatch or transport model.

## Idempotency by design

Most `g` commands are target-state, not actions. `g delta` means "the changes tab is the active tab", not "switch to the changes tab and increment a counter". Two `g delta` calls produce the same final state as one.

This makes commands safe to retry and lets the client treat each intent as a target assignment rather than an accumulated transition. Commands that cannot be idempotent must make their acceptance and retry semantics explicit.

## Results and errors

The consolidated endpoint returns `{ output: string }` on success. HTTP failures use the server's standard `{ ok: false, code, message }` envelope. The server owns command validation, authoritative work, and shell-facing command output; the CLI only writes that output or prefixes a transport failure with `g:`.

The CLI exit codes are conventional: `0` for success, `1` for a server or transport failure, and `2` for an unknown local command or another CLI-local usage error. Server-side argument rejection is an HTTP failure and therefore exits with `1`.

## Modes

The server starts with `bun run start`, `serve.sh`, or the standalone `goblin`
binary. Browser tabs connect over HTTP and WebSocket. The private terminal
launcher invokes the same executable in CLI mode and forwards its arguments;
it contains no credentials and is removed when the server exits.

For a command that needs a client intent, no listening window produces the same clear "no client" error. Commands that operate only on server-owned state do not require a listening client.

## What this design is not

- It is not a general CLI for repo operations. Server-owned capabilities stay behind their owning applications; `g` reaches them only through the consolidated command endpoint for user-facing terminal actions.
- It is not a place for backend logic. Server-side operations stay in their owning repo, terminal, or settings applications behind the consolidated route. `g` is a wrapper, not a peer.
- The client intent router handles CLI view requests and terminal notification
  clicks. Ordinary UI actions call their owning application commands directly.

## Adding a command

The pattern for adding a new `g` command:

1. Decide whether it is purely local or server-backed. Every server-backed command uses the single terminal-command HTTP entry point, including commands that ultimately publish a client intent.
2. Define and validate its command payload at that server boundary. Control-plane work then routes through the shared client intent path.
3. Register a thin shell entry that forwards the command envelope and presents the server result.
4. Add tests according to `testing.md`, covering the command's observable envelope and failure modes.

## Why this is the right level of abstraction

The temptation is to make `g` more powerful — add state, add subcommands, add interactivity. The right counter-pressure is: anything that requires persistent state belongs on the server (where state is shared with the client); anything that requires a server round-trip belongs on the server too; anything that is purely about presenting an action to the user belongs in `g`.

If a feature would require `g` to grow stateful semantics, it's usually a sign the feature belongs in the client or the server, not the CLI.
