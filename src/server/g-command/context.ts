// Commands receive their process inputs and parent-server transport through
// one explicit invocation context.

export interface GoblinCommandIo {
  stdout(message: string): void
  stderr(message: string): void
}

// Minimal HTTP transport for the single server-backed command entry point.
export interface GoblinCommandTransport {
  postJson<T>(pathname: string, body: unknown, decode: (value: unknown) => T): Promise<T>
}

export interface GoblinCommandContext {
  args: string[]
  env: NodeJS.ProcessEnv
  io: GoblinCommandIo
  transport: GoblinCommandTransport
}

export interface GoblinCommand {
  /** Primary name (e.g. `delta`, `info`, `log`, `help`). */
  name: string
  /** One-line summary shown in `g help` and `usage()`. */
  summary: string
  /** Optional extended usage line, e.g. `g log <ref>`. */
  usage?: string
  run: (ctx: GoblinCommandContext) => Promise<number>
}
