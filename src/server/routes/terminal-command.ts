import { createRouteApp, parseHttpBody } from '#/server/common/http-validate.ts'
import { errorJson } from '#/server/common/responses.ts'
import { userIdFromContext } from '#/server/common/identity.ts'
import { GOBLIN_SERVER_COMMAND_REQUEST_SCHEMA } from '#/shared/g-command.ts'
import type { ServerTerminalCommandHost } from '#/server/terminal/terminal-command-host.ts'
import { publishClientIntent } from '#/server/realtime/client-intent-broker.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'

const VIEW_TAB_BY_COMMAND = {
  delta: 'changes',
  info: 'status',
  log: 'history',
} as const satisfies Record<string, WorkspacePaneStaticTabType>

export function createTerminalCommandRoutes(host: ServerTerminalCommandHost) {
  const app = createRouteApp()

  app.post('/', async (c) => {
    const request = await parseHttpBody(GOBLIN_SERVER_COMMAND_REQUEST_SCHEMA, c)
    if (request.command === 'term') {
      const { terminalSessionId, args } = request.payload
      const result = await host.execute(requiredUserId(c), terminalSessionId, args, c.req.raw.signal)
      return result.ok ? c.json(result.value) : errorJson(c, 'TERMINAL_UNAVAILABLE', result.message, 409)
    }
    if (request.payload.args.length > 0) {
      return errorJson(c, 'BAD_REQUEST', `'${request.command}' does not take arguments`)
    }
    const delivered = publishClientIntent({
      type: 'show-workspace-pane-tab-requested',
      tab: VIEW_TAB_BY_COMMAND[request.command],
    })
    return delivered
      ? c.json({ output: '' })
      : errorJson(c, 'NO_CLIENT', 'no Goblin window is currently listening for intents', 503)
  })

  return app
}

function requiredUserId(context: Parameters<typeof userIdFromContext>[0]): string {
  const userId = userIdFromContext(context)
  if (!userId) throw new Error('authenticated user identity unavailable')
  return userId
}
