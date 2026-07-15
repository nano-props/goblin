import type { ServerRepoMutationHost } from '#/server/repo-mutation/repo-mutation-host.ts'
export function createRepoMutationApplication(): ServerRepoMutationHost {
  return {
    async deleteBranch(_userId, input) {
      return await input.deleteBranch()
    },
  }
}
