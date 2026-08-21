import * as v from 'valibot'

export const GOBLIN_TERMINAL_SESSION_ID_ENV = 'GOBLIN_TERMINAL_SESSION_ID'

export const GOBLIN_SERVER_COMMAND_RESULT_SCHEMA = v.strictObject({ output: v.string() })

export type GoblinServerCommandResult = v.InferOutput<typeof GOBLIN_SERVER_COMMAND_RESULT_SCHEMA>
