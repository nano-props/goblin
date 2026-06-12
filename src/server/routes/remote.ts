import { Hono } from 'hono'
import {
  getServerRemotePathSuggestions,
  getServerSshHosts,
  resolveServerRemoteTarget,
  testServerRemoteRepository,
} from '#/server/modules/remote.ts'
import { normalizeRemoteTarget, type RemoteRepoTarget } from '#/shared/remote-repo.ts'

export function createRemoteRoutes() {
  const app = new Hono()
  async function jsonOr<T>(run: () => Promise<T>, fallback: T, label: string): Promise<T> {
    try {
      return await run()
    } catch (err) {
      console.warn(`[server][remote] ${label} failed`, err)
      return fallback
    }
  }
  app.get('/ssh-hosts', async (c) => c.json(await getServerSshHosts()))
  app.post('/resolve-target', async (c) => {
    const body = await c.req.json().catch(() => null)
    const alias = typeof body?.alias === 'string' ? body?.alias : ''
    const remotePath = typeof body?.remotePath === 'string' ? body?.remotePath : ''
    // Throws (e.g. error.ssh-config-changed) when the alias is not in the
    // current ~/.ssh/config. We surface that as a typed error result so the
    // renderer can render a friendly "config changed" message instead of an
    // unhandled HTTP 500.
    return c.json(
      await jsonOr<{ target: RemoteRepoTarget } | { error: string }>(
        () => resolveServerRemoteTarget({ alias, remotePath }, c.req.raw.signal) as Promise<{ target: RemoteRepoTarget }>,
        { error: 'error.ssh-config-changed' },
        'resolve-target',
      ),
    )
  })
  app.post('/path-suggestions', async (c) => {
    const body = await c.req.json().catch(() => null)
    const alias = typeof body?.alias === 'string' ? body?.alias : ''
    const remotePath = typeof body?.remotePath === 'string' ? body?.remotePath : ''
    const prefix = typeof body?.prefix === 'string' ? body?.prefix : ''
    return c.json(
      await jsonOr(
        () => getServerRemotePathSuggestions({ alias, remotePath, prefix }, c.req.raw.signal),
        [],
        'path-suggestions',
      ),
    )
  })
  app.post('/test-repository', async (c) => {
    const body = await c.req.json().catch(() => null)
    const target = normalizeRemoteTarget(body?.target)
    const diagnosticFallback = {
      target: target ?? (body?.target as never),
      ok: false as const,
      category: 'config-changed' as const,
      message: 'error.ssh-config-changed',
      stages: [
        { name: 'ssh' as const, label: 'ssh', status: 'failed' as const, category: 'config-changed' as const, message: 'error.ssh-config-changed' },
        { name: 'shell' as const, label: 'shell', status: 'skipped' as const },
        { name: 'git' as const, label: 'git', status: 'skipped' as const },
        { name: 'path' as const, label: 'path', status: 'skipped' as const },
        { name: 'repo' as const, label: 'repo', status: 'skipped' as const },
      ],
    }
    return c.json(
      await jsonOr(
        () => testServerRemoteRepository(target ?? (body?.target as never), c.req.raw.signal),
        diagnosticFallback,
        'test-repository',
      ),
    )
  })
  return app
}
