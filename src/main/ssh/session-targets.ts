import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

const remoteTargetsById = new Map<string, RemoteRepoTarget>()

export function registerRemoteRepoTarget(target: RemoteRepoTarget): void {
  remoteTargetsById.set(target.id, target)
}

export function getRegisteredRemoteRepoTarget(repoId: string): RemoteRepoTarget | null {
  return remoteTargetsById.get(repoId) ?? null
}
