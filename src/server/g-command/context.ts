// Shared types for the `g` command CLI. The CLI runs inside PTYs that
// the Goblin server itself spawned, so it can assume:
//   - a server is reachable (env-provided URL + access token)
//   - `args` come from `process.argv.slice(2)`
//   - `env` is the inherited PTY environment
// Commands declare what they need (a transport, a server URL) via the
// `GoblinCommand.run(ctx)` contract. The entry point
// (`#/server/entrypoints/g-command.ts`) constructs the ctx; tests
// construct their own.

export interface GoblinCommandIo {
  stdout(message: string): void
  stderr(message: string): void
}

// Minimal HTTP transport. Today: only POST to dispatch an intent
// (`/api/repo/view`). Kept narrow so a future capability (e.g. a
// read endpoint, command-line websocket, file fallback) can extend
// the interface without re-shaping every existing command.
export interface GoblinCommandTransport {
  postJson<T>(pathname: string, body: unknown): Promise<T>
}

export interface GoblinCommandContext {
  args: string[]
  env: NodeJS.ProcessEnv
  io: GoblinCommandIo
  transport: GoblinCommandTransport
}

// A `GoblinCommand` is the unit of dispatch. Each command owns its
// argv parsing, its side effects, and its error mapping. The CLI
// (`cli.ts`) is reduced to lookup-and-run; adding a command = adding
// one entry to the registry (`registry.ts`).
export interface GoblinCommand {
  /** Primary name (e.g. `delta`, `info`, `log`, `help`). */
  name: string
  /** One-line summary shown in `g help` and `usage()`. */
  summary: string
  /** Optional extended usage line, e.g. `g log <ref>`. */
  usage?: string
  run: (ctx: GoblinCommandContext) => Promise<number>
}
