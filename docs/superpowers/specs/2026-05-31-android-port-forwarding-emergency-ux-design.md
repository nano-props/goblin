# Android Port Forwarding And Emergency UX Design

## Goal

Phase 4 completes the phone emergency loop by adding explicit SSH local port forwarding for remote development services, lifecycle visibility, and a clear local terminal placeholder for v1 scope.

## Scope

In scope:

- Start and stop SSH local forwards from a saved remote repository.
- Bind forwarded services to Android loopback only.
- Support automatic local port selection and user-specified local ports.
- Default the remote service host to `127.0.0.1`.
- Show active, stopped, and failed tunnel sessions in the repository workspace.
- Open and copy the forwarded local URL.
- Make long-lived tunnel ownership visible so users can stop sessions intentionally.
- Represent Android-local terminal support as a placeholder, not as v1 local Git parity.

Out of scope:

- Remote port forwarding.
- Dynamic reverse tunnels.
- Persisting tunnel sessions across app process death.
- Background tunneling without visible user affordance.
- Full Android-local shell, package manager, or local Git workflows.

## Architecture

Add a focused port-forward model and manager. The model owns validation, URL formatting, and session snapshot shape. The manager owns runtime session state and delegates SSHJ-specific forwarding to a backend interface. This keeps tests independent from network sockets while leaving the production backend small.

Production SSH forwarding uses SSHJ `SSHClient.newLocalPortForwarder(Parameters, ServerSocket)`. The backend authenticates with the same identity and host-key policy used by the SSH terminal. It opens a loopback `ServerSocket`, starts SSHJ's listener on a daemon thread, and closes the forwarder, socket, and SSH client when the user stops the session.

Repository UI gains a `Ports` tab. It creates a tunnel request, starts the manager, lists sessions for the current repository, and exposes Stop, Copy URL, and Open URL actions. UI copy makes the lifecycle explicit: tunnels are app runtime sessions and can be stopped from the workspace.

Foreground/background behavior is represented by a small lifecycle decision model first. For v1 MVP, active tunnels are visible in-app and built so an Android foreground service can wrap the same manager without changing session semantics. Silent background tunneling remains out of scope.

## Safety Model

- Local bind host is always `127.0.0.1`.
- Remote service host defaults to `127.0.0.1` and must not be blank.
- Remote port must be `1..65535`.
- Local port may be `0` for automatic allocation or `1..65535`.
- Tunnel sessions are runtime-only and are not saved into repository records.
- Stopping a repository workspace can stop all sessions owned by that repository.
- Failed starts produce a failed session snapshot with a user-visible message.

## Testing

Use TDD:

- Unit tests for port request validation and local URL formatting.
- Manager tests with a fake backend for start, stop, failure, and owner cleanup.
- SSHJ backend-adjacent tests for helper defaults and lifecycle contracts without opening a real SSH connection.
- UI-state tests for the `Ports` tab, create enablement, lifecycle text, and local terminal placeholder copy.

