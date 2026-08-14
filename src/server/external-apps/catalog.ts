import { probeExternalApps } from '#/system/external-apps.ts'
import type { ExternalAppsSnapshot } from '#/shared/api-types.ts'

export async function buildServerExternalAppsSnapshot(signal?: AbortSignal): Promise<ExternalAppsSnapshot> {
  const state = await probeExternalApps(signal)
  return { terminal: state.terminals, editor: state.editors }
}

export async function getServerExternalAppsSnapshot(signal?: AbortSignal): Promise<ExternalAppsSnapshot> {
  return await buildServerExternalAppsSnapshot(signal)
}
