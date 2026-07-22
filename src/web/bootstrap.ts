import type { ClientBootstrapSnapshot } from '#/shared/bootstrap.ts'
import { getClientBridge } from '#/web/client-bridge.ts'

function readInitialBootstrap(): ClientBootstrapSnapshot {
  return getClientBridge().getBootstrap()
}

const initialBootstrap = readInitialBootstrap()

export function getInitialBootstrap(): ClientBootstrapSnapshot {
  return initialBootstrap
}
