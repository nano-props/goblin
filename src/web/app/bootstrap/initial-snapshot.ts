import type { ClientBootstrapSnapshot } from '#/shared/bootstrap.ts'
import { getClientBridge } from '#/web/bridge/client.ts'

function readInitialBootstrap(): ClientBootstrapSnapshot {
  return getClientBridge().getBootstrap()
}

const initialBootstrap = readInitialBootstrap()

export function getInitialBootstrap(): ClientBootstrapSnapshot {
  return initialBootstrap
}
