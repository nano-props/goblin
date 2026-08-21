import type { GoblinServerCommandResult } from '#/shared/g-command.ts'

export type TerminalCommandHostResult<T> = { ok: true; value: T } | { ok: false; message: string }

export interface ServerTerminalCommandHost {
  execute(
    userId: string,
    terminalSessionId: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<TerminalCommandHostResult<GoblinServerCommandResult>>
}
