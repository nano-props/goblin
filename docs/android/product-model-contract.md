# Goblin Android Product Model Contract

**Status:** Phase 1 baseline
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
