# The `g` shell command

`g` is the shell-side handle into a running Goblin server. It runs inside the PTY sessions that Goblin itself spawns, and lets users do things from the command line that would otherwise require clicking through the UI.

This document describes the architecture and the reasoning behind it. It does not describe any specific command's behaviour or wire format — those live with their code.

## Two planes

`g`'s design recognises two distinct kinds of operation:

- **Data plane** — read or modify server-owned state (repo info, settings, terminals). Goes over HTTP because that's the same transport the browser and Electron client already use, with the same auth and the same error shapes.
- **Control plane** — push commands into the client (open this tab, focus this view, run that action). Goes over a dedicated WebSocket because rendering is not a query — the client subscribes to a stream and reacts.

The server sits between `g` and the client on the control plane. It does not interpret what an intent means; it envelopes and forwards. The client has one intent router that consumes intents from every supported source and applies them through the same handler chain.

## Why the server brokers intents

In a typical desktop app, a CLI would talk to the native host directly. Goblin puts the broker in the server because:

- The server is the only process that exists in both Electron mode and standalone (`serve.sh`) mode. Putting the broker in the server means `g` works the same way in either mode — the client subscribes the same way regardless of how the server was launched.
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

The CLI is reduced to `find by name → call run`. Each `run` receives a context with args, env, I/O, and a transport. The transport abstracts HTTP so command logic stays independent of the wire.

Dispatch remains data-driven as the command set grows. Command groups may organize the registry, but they must not introduce a second dispatch or transport model.

## Idempotency by design

Most `g` commands are target-state, not actions. `g delta` means "the changes tab is the active tab", not "switch to the changes tab and increment a counter". Two `g delta` calls produce the same final state as one.

This makes commands safe to retry and lets the client treat each intent as a target assignment rather than an accumulated transition. Commands that cannot be idempotent must make their acceptance and retry semantics explicit.

## The error envelope

`g` and the server share one response envelope for control-plane commands:

- success: `{ ok: true }`
- failure: `{ ok: false, code, message }`

The server reports domain facts; the CLI owns shell-facing presentation. Error decoration therefore happens in one place and is never embedded in the server reason.

The CLI exit codes are conventional: `0` success, `1` server or transport error, `2` argument error.

## Modes

Two runtime modes, identical from `g`'s perspective:

- **Electron** — the native host spawns the server as a child. Clients in BrowserWindows connect over HTTP + WS as usual.
- **`serve.sh`** — a standalone server, no Electron process. Browser tabs (or a manually-launched Electron window) connect the same way.

The only difference `g` can observe: when no client is listening on the control-plane WS, the server returns a clear "no client" error. This is the same error in both modes and is the intended behaviour — `g` is a frontend command, not a backend one.

## What this design is not

- It is not a general CLI for repo operations. The server already exposes rich HTTP routes for those; `g` reuses them via the transport, but `g` itself is for _user-facing_ actions that benefit from terminal ergonomics (open a tab, jump to a branch).
- It is not a place for backend logic. Server-side operations stay in the existing repo / terminal / settings routes. `g` is a wrapper, not a peer.
- It is not the only path for client intents. Electron IPC still works for menu-driven commands. `g` is one of several producers feeding the same intent router.

## Adding a command

The pattern for adding a new `g` command:

1. Decide which plane it uses. Reads and writes that target server state go through the HTTP transport. Commands that should reach the client go through the WS broker.
2. For control-plane commands, define and validate the intent at the broker boundary, then route it through the shared client intent path.
3. Register the command using the smallest abstraction that expresses its arguments, transport, and result semantics.
4. Add tests according to `testing.md`, covering the command's observable envelope and failure modes.

## Why this is the right level of abstraction

The temptation is to make `g` more powerful — add state, add subcommands, add interactivity. The right counter-pressure is: anything that requires persistent state belongs on the server (where state is shared with the client); anything that requires a server round-trip belongs on the server too; anything that is purely about presenting an action to the user belongs in `g`.

If a feature would require `g` to grow stateful semantics, it's usually a sign the feature belongs in the client or the server, not the CLI.
