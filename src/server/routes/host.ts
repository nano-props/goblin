import { createRouteApp } from '#/server/common/http-validate.ts'
import { getServerHostInfo, type HostInfo } from '#/server/modules/host-info.ts'

/**
 * Public host-info endpoint.
 *
 *   GET /api/host  ->  { homeDir, platform, hostname, pid }
 *
 * Returns non-sensitive facts about the host the server is running
 * on — the client's settings page needs them to render
 * platform-aware UI (default clone parent dir, terminal backend
 * list), and the embedded client's home-dir display reads the
 * same value the user's terminal sees (`echo $HOME`).
 *
 * The information isn't sensitive: `homeDir` is a directory path,
 * not a secret, and `platform` is `process.platform`. The endpoint
 * is intentionally unauthenticated so the client can fetch it
 * before the user clears the token gate (the settings page mounts
 * inside the gate too, on first paint).
 *
 * Replaces the Electron preload's `goblin:get-home-dir` /
 * `goblin:get-platform` IPC channels. Both repoOperationSchedulers now go through
 * the same HTTP path; the embedded main no longer needs to plant
 * host info into the client's bootstrap script before loadURL.
 */
export function createHostRoutes() {
  const app = createRouteApp()
  app.get('/', (c) => c.json(getServerHostInfo() satisfies HostInfo))
  return app
}
