import { createOpaqueId } from '#/shared/opaque-id.ts'

const clientPageId = createOpaqueId('client')

/** Identity of this browser page or Electron renderer module instance. */
export function readClientPageId(): string {
  return clientPageId
}
