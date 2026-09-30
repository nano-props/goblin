// Component harnesses mount below the entrypoint's host hydration boundary.
import { hostInfoStore } from '#/web/stores/host-info.ts'
import type { HostInfoSnapshot } from '#/web/stores/host-info.ts'

export function seedHostInfoForTest(
  snapshot: HostInfoSnapshot = { homeDir: '/Users/test', platform: 'darwin', hostname: 'test-host', pid: 1 },
): void {
  hostInfoStore.setState({ snapshot, status: 'ready', error: null })
}
