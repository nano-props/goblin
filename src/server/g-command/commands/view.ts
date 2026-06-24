import type { GoblinCommand, GoblinCommandContext } from '#/server/g-command/context.ts'
import type { RepoViewResult } from '#/shared/repo-view.ts'
import type { WorkspacePaneStaticViewType } from '#/shared/workspace-pane.ts'

// Build a `g <name>` command that opens a workspace pane view. All
// three commands share the same shape: validate args, POST
// `{ tab }` to the server, map the response to a process exit code.
//
// Idempotency ("open or switch") is delegated to the server's
// `show-workspace-pane-view-requested` intent — the client's plan
// (`#/web/hooks/client-effect-intent-plans.ts`) treats this as a
// pure active-tab assignment, so calling it twice with the same
// `tab` is a no-op the second time.
//
// The response shape lives in `#/shared/repo-view.ts` so the server
// route and the CLI consume the same type — see that file for why
// the contract must live in `shared/`.
function createViewCommand(name: string, tab: WorkspacePaneStaticViewType): GoblinCommand {
  return {
    name,
    summary: `Open the ${tab} tab in the Goblin window`,
    async run(ctx: GoblinCommandContext): Promise<number> {
      if (ctx.args.length > 1) {
        ctx.io.stderr(`g: '${name}' does not take arguments\n\nUsage: g ${name}`)
        return 2
      }
      try {
        const result = await ctx.transport.postJson<RepoViewResult>('/api/repo/view', { tab })
        if (!result.ok) {
          ctx.io.stderr(`g: ${result.message}`)
          return 1
        }
        return 0
      } catch (err) {
        ctx.io.stderr(`g: ${err instanceof Error ? err.message : String(err)}`)
        return 1
      }
    },
  }
}

export const VIEW_COMMANDS: readonly GoblinCommand[] = [
  createViewCommand('delta', 'changes'),
  createViewCommand('st', 'status'),
  createViewCommand('log', 'history'),
]
