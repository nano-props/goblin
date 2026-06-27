# The `g` shell command

`g` is the shell-side handle into a running Goblin server. It runs inside the PTY sessions that Goblin itself spawns, and lets users do things from the command line that would otherwise require clicking through the UI.

This document describes the architecture and the reasoning behind it. It does not describe any specific command's behaviour or wire format — those live with their code.

## Two planes

`g`'s design recognises two distinct kinds of operation:

- **Data plane** — read or modify server-owned state (repo info, settings, terminals). Goes over HTTP because that's the same transport the browser and Electron client already use, with the same auth and the same error shapes.
- **Control plane** — push commands into the client (open this tab, focus this view, run that action). Goes over a dedicated WebSocket because rendering is not a query — the client subscribes to a stream and reacts.

The server sits between `g` and the client on the control plane. It does not interpret what an intent means; it envelopes and forwards. The client has one intent router that consumes intents from any source (Electron IPC, server WS, future producers) and applies them through the same handler chain.

## Why the server brokers intents

In a typical desktop app, a CLI would talk to the main process directly. Goblin puts the broker in the server because:

- The server is the only process that exists in both Electron mode and standalone (`serve.sh`) mode. Putting the broker in the server means `g` works the same way in either mode — the client subscribes the same way regardless of how the server was launched.
- The client's intent router already exists. Adding a new producer means adding a subscription, not a new router.
- HTTP and WS share the same auth and lifecycle. Adding a separate IPC channel would mean a third transport with its own auth model and lifecycle.

The cost is that the server knows about envelope shapes. The benefit is that the server doesn't — and never needs to — know what any specific intent does.

## Command registry

Adding a `g <subcommand>` is one entry in a table:

- a name
- a one-line summary
- an optional usage hint
- a `run(ctx)` function

The CLI is reduced to `find by name → call run`. Each `run` receives a context with args, env, I/O, and a transport. The transport abstracts HTTP so command logic stays independent of the wire.

This shape scales linearly: the first command and the tenth command cost the same to add. Adding a sub-domain of commands (e.g. a "branches" namespace) is one new file under `commands/` plus one registry entry — no central dispatch table needs editing.

## Idempotency by design

Most `g` commands are target-state, not actions. `g delta` means "the changes tab is the active tab", not "switch to the changes tab and increment a counter". Two `g delta` calls produce the same final state as one.

This makes commands safe to retry and lets the client treat each intent as a pure assignment rather than a stateful transition. The client's existing intent plan for view-switching is already a pure assignment — `g` leans on that rather than introducing a new model.

## The error envelope

`g` and the server share one response shape for view commands:

- success: `{ ok: true }`
- failure: `{ ok: false, code, message }`

The CLI prefixes every error message it surfaces with `g:`. The server returns raw reasons; the CLI decorates. This is a one-place rule: server-side messages are facts, CLI output is presentation. The first version of the code put `g:` on both sides and produced visible double-prefix bugs in production-style failure paths.

The CLI exit codes are conventional: `0` success, `1` server or transport error, `2` argument error.

## Modes

Two runtime modes, identical from `g`'s perspective:

- **Electron** — the main process spawns the server as a child. Clients in BrowserWindows connect over HTTP + WS as usual.
- **`serve.sh`** — a standalone server, no Electron process. Browser tabs (or a manually-launched Electron window) connect the same way.

The only difference `g` can observe: when no client is listening on the control-plane WS, the server returns a clear "no client" error. This is the same error in both modes and is the intended behaviour — `g` is a frontend command, not a backend one.

## What this design is not

- It is not a general CLI for repo operations. The server already exposes rich HTTP routes for those; `g` reuses them via the transport, but `g` itself is for _user-facing_ actions that benefit from terminal ergonomics (open a tab, jump to a branch).
- It is not a place for backend logic. Server-side operations stay in the existing repo / terminal / settings routes. `g` is a wrapper, not a peer.
- It is not the only path for client intents. Electron IPC still works for menu-driven commands. `g` is one of several producers feeding the same intent router.

## Adding a command

The pattern for adding a new `g` command:

1. Decide which plane it uses. Reads and writes that target server state go through the HTTP transport. Commands that should reach the client go through the WS broker.
2. For control-plane commands, add a route on the server that validates the request and calls the intent publisher. The client side needs no changes — the existing intent router picks the intent up.
3. Implement the command as a registry entry. Use the existing factory pattern if the new command shares shape with an existing one; otherwise write the `run` function inline.
4. Add tests according to `testing.md`, covering the command's observable envelope and failure modes.

When in doubt, look at an existing command — the view commands are the canonical example.

## Why this is the right level of abstraction

The temptation is to make `g` more powerful — add state, add subcommands, add interactivity. The right counter-pressure is: anything that requires persistent state belongs on the server (where state is shared with the client); anything that requires a server round-trip belongs on the server too; anything that is purely about presenting an action to the user belongs in `g`.

If a feature would require `g` to grow stateful semantics, it's usually a sign the feature belongs in the client or the server, not the CLI.
