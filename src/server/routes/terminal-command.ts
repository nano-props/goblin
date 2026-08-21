import { createRouteApp, parseHttpBody } from '#/server/common/http-validate.ts'
import { errorJson } from '#/server/common/responses.ts'
import { userIdFromContext } from '#/server/common/identity.ts'
import { TERMINAL_COMMAND_PROCEDURE_SCHEMAS } from '#/shared/procedure-schemas.ts'
import type { ServerTerminalCommandHost } from '#/server/terminal/terminal-command-host.ts'
import { publishClientIntent } from '#/server/realtime/client-intent-broker.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { isValidTerminalSessionId } from '#/server/terminal/terminal-session-ids.ts'
import { runGitWorkspaceRuntimeRequest } from '#/server/workspaces/runtime/request.ts'
import { CodedError } from '#/shared/coded-error.ts'
import type { DictKey } from '#/shared/i18n/en.ts'
import { getServerI18nSnapshot } from '#/server/i18n.ts'

const TERMINAL_COMMAND_RUNTIME_ERROR_KEYS = [
  'error.failed-read-repo',
  'error.workspace-runtime-settlement-failed',
] as const satisfies readonly DictKey[]

type TerminalCommandRuntimeErrorKey = (typeof TERMINAL_COMMAND_RUNTIME_ERROR_KEYS)[number]

const VIEW_TAB_BY_COMMAND = {
  delta: 'changes',
  info: 'status',
  log: 'history',
} as const satisfies Record<string, WorkspacePaneStaticTabType>

export function createTerminalCommandRoutes(host: ServerTerminalCommandHost) {
  const app = createRouteApp()

  app.post('/', async (c) => {
    const request = await parseHttpBody(TERMINAL_COMMAND_PROCEDURE_SCHEMAS.execute, c)
    if (request.command === 'term') {
      const { terminalSessionId, args } = request.payload
      if (!isValidTerminalSessionId(terminalSessionId)) {
        return errorJson(c, 'BAD_REQUEST', 'g term must run inside a current Goblin terminal')
      }
      const userId = requiredUserId(c)
      const signal = c.req.raw.signal
      try {
        const result = await runGitWorkspaceRuntimeRequest({
          userId,
          label: 'g-term',
          signal,
          run: () => host.execute(userId, terminalSessionId, args, signal),
        })
        // This endpoint is a private CLI boundary: the human-readable message owns
        // failure detail, while one transport code keeps the protocol deliberately small.
        return result.ok ? c.json(result.value) : errorJson(c, 'TERMINAL_UNAVAILABLE', result.message, 409)
      } catch (error) {
        if (!(error instanceof CodedError)) throw error
        const messageKey = terminalCommandRuntimeErrorKey(error.message)
        if (!messageKey) throw error
        const { dict } = await getServerI18nSnapshot(c.req.header('accept-language'))
        return errorJson(c, error.code, dict[messageKey])
      }
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

function terminalCommandRuntimeErrorKey(message: string): TerminalCommandRuntimeErrorKey | null {
  return TERMINAL_COMMAND_RUNTIME_ERROR_KEYS.find((key) => key === message) ?? null
}

function requiredUserId(context: Parameters<typeof userIdFromContext>[0]): string {
  const userId = userIdFromContext(context)
  if (!userId) throw new Error('authenticated user identity unavailable')
  return userId
}
