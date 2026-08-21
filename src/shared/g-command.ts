import * as v from 'valibot'

export const GOBLIN_TERMINAL_SESSION_ID_ENV = 'GOBLIN_TERMINAL_SESSION_ID'

const CommandArgsSchema = v.pipe(v.array(v.pipe(v.string(), v.maxLength(64))), v.maxLength(2))
const ViewPayloadSchema = v.strictObject({ args: CommandArgsSchema })
const TerminalPayloadSchema = v.strictObject({
  terminalSessionId: v.pipe(v.string(), v.maxLength(128)),
  args: CommandArgsSchema,
})

export const GOBLIN_SERVER_COMMAND_REQUEST_SCHEMA = v.variant('command', [
  v.strictObject({ command: v.literal('delta'), payload: ViewPayloadSchema }),
  v.strictObject({ command: v.literal('info'), payload: ViewPayloadSchema }),
  v.strictObject({ command: v.literal('log'), payload: ViewPayloadSchema }),
  v.strictObject({ command: v.literal('term'), payload: TerminalPayloadSchema }),
])

export const GOBLIN_SERVER_COMMAND_RESULT_SCHEMA = v.strictObject({ output: v.string() })

export type GoblinServerCommandResult = v.InferOutput<typeof GOBLIN_SERVER_COMMAND_RESULT_SCHEMA>
