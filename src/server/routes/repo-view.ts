import * as v from 'valibot'
import { publishClientIntent } from '#/server/modules/client-intent-broker.ts'
import { createRouteApp, parseHttpBody } from '#/server/common/http-validate.ts'
import { WORKSPACE_PANE_STATIC_TAB_TYPES } from '#/shared/workspace-pane.ts'
import type { RepoViewResult } from '#/shared/repo-view.ts'

// Body schema for `POST /api/repo/view`. Only the three static views
// are addressable through `g` commands; `terminal` is intentionally
// excluded because the terminal tab is owned by the runtime
// (controller/takeover semantics — see docs/terminal-target-model.md)
// and shouldn't be reachable via a CLI side-channel.
const RepoViewBodySchema = v.object({
  tab: v.picklist(WORKSPACE_PANE_STATIC_TAB_TYPES),
})

export function createRepoViewRoutes() {
  const app = createRouteApp()

  app.post('/view', async (c): Promise<Response> => {
    const { tab } = await parseHttpBody(RepoViewBodySchema, c)
    // No client subscribed → 503 with a clear message. We don't
    // queue: a queued intent that lands in a stale UI state is
    // worse than no-op, and `g` is human-triggered so the user can
    // simply rerun it.
    const delivered = publishClientIntent({ type: 'show-workspace-pane-tab-requested', tab })
    const result: RepoViewResult = delivered
      ? { ok: true }
      : {
          ok: false,
          code: 'NO_CLIENT',
          // No CLI-level `g:` prefix here — the CLI prefixes every
          // error message it surfaces, and the contract is "this
          // string is the raw reason; CLI decorates".
          message: 'no Goblin window is currently listening for intents',
        }
    return c.json(result, delivered ? 200 : 503)
  })

  return app
}
