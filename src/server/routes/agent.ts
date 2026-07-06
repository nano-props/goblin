import { userIdFromContext } from '#/server/common/identity.ts'
import { createRouteApp, parseHttpBody } from '#/server/common/http-validate.ts'
import { errorJson } from '#/server/common/responses.ts'
import type { AgentSessionService } from '#/server/agent/agent-session-service.ts'
import { AGENT_PROCEDURE_SCHEMAS } from '#/shared/procedure-schemas.ts'

export function createAgentRoutes(service: AgentSessionService) {
  const app = createRouteApp()

  app.post('/create', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return errorJson(c, 'FORBIDDEN', 'Unauthorized', 401)
    const input = await parseHttpBody(AGENT_PROCEDURE_SCHEMAS.create, c)
    return c.json(await service.create(userId, input))
  })

  app.post('/list', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return errorJson(c, 'FORBIDDEN', 'Unauthorized', 401)
    const input = await parseHttpBody(AGENT_PROCEDURE_SCHEMAS.list, c)
    return c.json(await service.list(userId, input))
  })

  app.post('/get', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return errorJson(c, 'FORBIDDEN', 'Unauthorized', 401)
    const input = await parseHttpBody(AGENT_PROCEDURE_SCHEMAS.get, c)
    const session = await service.get(userId, input)
    if (!session) return errorJson(c, 'NOT_FOUND', 'Agent session not found', 404)
    return c.json(session)
  })

  app.post('/send-message', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return errorJson(c, 'FORBIDDEN', 'Unauthorized', 401)
    const input = await parseHttpBody(AGENT_PROCEDURE_SCHEMAS.sendMessage, c)
    return c.json(await service.sendMessage(userId, input))
  })

  app.post('/close', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return errorJson(c, 'FORBIDDEN', 'Unauthorized', 401)
    const input = await parseHttpBody(AGENT_PROCEDURE_SCHEMAS.close, c)
    return c.json(await service.close(userId, input))
  })

  app.post('/close-worktree', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return errorJson(c, 'FORBIDDEN', 'Unauthorized', 401)
    const input = await parseHttpBody(AGENT_PROCEDURE_SCHEMAS.closeWorktree, c)
    return c.json(await service.closeForWorktree(userId, input))
  })

  return app
}
