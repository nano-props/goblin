# SSH Remote Workspaces

## Principle

Remote workspaces use a **local-decision, remote-execution** model:

- The local process decides what to run, quotes every argument, and parses the result.
- The remote host only executes the command that was sent to it.
- Keep business logic on the local side unless the data exists only remotely.

## Operations

Each operation becomes one self-contained shell script sent over SSH. The script is generated from a typed descriptor, with all user input validated and single-quoted. The local side interprets stdout/stderr; the remote side only runs the script.

Connections are reused through a per-target SSH multiplexing socket kept under the application state directory.

## Transport defaults

- Strict host-key checking is enforced.
- The SSH alias is passed directly to the SSH executable, never interpolated into a local shell command.
- Connection, read, and mutation timeouts are explicit. Cancellation kills the remote process.
- Commands run non-interactively.

## Diagnostics

Before first use, the backend verifies the SSH handshake, shell sanity, and path existence. Git detection enriches a readable directory with Git capabilities when available; a non-Git directory remains a valid workspace. Failures are classified so the UI can show actionable messages.

## Worktree bootstrap

Bootstrap is the main exception: glob expansion and file materialization happen remotely because the files only exist there. The policy still originates locally: the configuration is parsed and validated locally, and only the mechanical steps run remotely. The setup command runs inside the new worktree root on the remote host.

## Security

- Validate and quote all user input before it reaches the script.
- Reject branch names that could be interpreted as Git options.
- Require absolute POSIX paths for worktree locations.
- Accept only concrete SSH aliases; wildcards and negated aliases are rejected.
- Treat setup commands as trusted repository configuration.
