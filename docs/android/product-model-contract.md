# Goblin Android Product Model Contract

**Status:** Phase 4 baseline
**Scope:** Android-native model names and behavior that preserve desktop Goblin semantics.

## Remote Target Identity

Desktop `RemoteRepoTarget` maps to Android `SshHostProfile` plus later repository/worktree target models.

| Desktop concept | Android Phase 1 concept | Notes |
|---|---|---|
| `host` | `SshHostProfile.host` | Required non-empty SSH host name or address. |
| `user` | `SshHostProfile.user` | Required non-empty SSH user. |
| `port` | `SshHostProfile.port` | Defaults to `22`; valid range is `1..65535`. |
| `alias` | `SshHostProfile.alias` | Optional display name. |
| `identityFile` | `SshIdentityRef` | Android stores an app-private identity reference, not desktop file paths. |
| `remotePath` | Deferred repository path | Phase 1 terminal spike may use a manually supplied path; repository browsing is Phase 2. |

The Android UI must pass typed target objects to services. Compose screens must never assemble remote shell command strings.

## Resource And Runtime State

Persistent resource state is separate from runtime SSH and terminal session state.

Persistent resources:

- Saved SSH host profiles.
- Trusted host-key fingerprints.
- Non-secret UI/session preferences.
- Imported identity references and protected encrypted key material.

## SSH Identity Storage

Android stores imported identity material in app-private files encrypted with an Android Keystore-backed AES-GCM key where the platform supports it. Saved host profiles contain only an `SshIdentityRef` id. They do not contain SSH passwords, passphrases, raw private key text, or decrypted identity bytes.

If an imported identity requires a passphrase, the app prompts with `Enter passphrase for this connection`. That passphrase is runtime-only input for the current connection attempt and is never written into host profiles, identity metadata, diagnostics results, or terminal session state.

Runtime-only state:

- Active SSH connections.
- Diagnostic execution progress.
- Terminal shell streams.
- Terminal output, scrollback, resize state, and connection state.
- SSH local port-forward sessions and socket handles.

Android resource states are `idle`, `loading`, `loaded`, `stale`, and `error`. SSH and terminal runtime states are modeled separately so live session details are not written into host profile storage.

## Diagnostics

Android diagnostics use the same five-stage shape as desktop Goblin:

1. SSH
2. Shell
3. Git
4. Path
5. Repo

Each stage exposes status, category, user-facing message, and optional details. Raw details belong behind expandable UI, not primary text.

## Terminal Lifecycle

Terminal sessions are runtime-only and owner-scoped to the selected host. Phase 1 proves a terminal spike from a host profile; Phase 3 adds worktree-scoped terminal behavior and replay-buffer implementation.

Terminal runtime state is not persisted with host profiles. Terminal output, shell handles, resize state, and close/failure state are owned by the active terminal controller and terminal service only.

Terminal SSH shell connections must reuse the stored host-key trust boundary established by diagnostics. Unknown or changed host keys return a connection failure instead of opening a terminal.

Required Phase 1 lifecycle states:

- Connecting
- Connected
- Resizing
- Exited
- Failed

Opening the Terminal route should start the SSH shell automatically for the selected host and path. After exit or failure, reconnect is an explicit user action.

Input and paste flow through the terminal controller into a shell stream. The controller must not build ad hoc shell commands from UI text. Send, paste, and helper-key actions must be disabled or visibly explained until the terminal is connected so disconnected input is not silently dropped.

Terminal output is capped for phone rendering. Phase 1 keeps only the latest rendered scrollback in runtime memory and uses a remaining-height viewport so keyboard and resize changes do not push the input controls off-screen.

All terminal SSH operations that can touch the network, including open, send, paste, helper keys, resize, and close, must run off the Compose main thread. Controller write failures transition terminal state to `Failed` instead of propagating through input-event dispatch.

## Remote Worktrees

Remote worktree creation and removal are explicit remote SSH operations. They are not local Android filesystem operations.

Remote repository snapshots can show primary, linked, locked, missing, dirty, and bare worktree states. Worktree terminal entry uses the selected remote worktree path and keeps the terminal session runtime-only.

Worktree removal is blocked for primary, dirty, locked, missing, and protected-branch worktrees. Protected branches are `main`, `master`, `develop`, and `release/*`. Allowed removals require confirmation text that states the remote worktree is removed from the SSH server and that the branch is not deleted.

## Port Forwarding

Port forwarding is SSH local forwarding for remote development services. Android binds forwarded services to `127.0.0.1` only. The remote service host defaults to `127.0.0.1`, and users supply the remote port plus an optional local port.

Port-forward sessions are runtime-only. Saved repository records store no tunnel ids, socket handles, assigned local ports, or SSH connection state. Deleting a saved repository record stops that repository's runtime tunnels before removing the app-local record.

Valid port-forward input:

- Remote port: `1..65535`.
- Local port: blank for automatic allocation, or `1..65535`.
- Explicit local port `0` from UI input is invalid; only blank input maps to automatic allocation.

Repository workspace exposes a `Ports` tab. Active tunnels show the remote service, local forwarded URL, lifecycle text, and actions to open, copy, or stop the URL.

## Local Terminal Scope

Android v1 is SSH remote-first. Android-local terminal and local Git parity are deferred from v1 and are represented as a placeholder so users do not mistake the app for the macOS client's local workflow.
