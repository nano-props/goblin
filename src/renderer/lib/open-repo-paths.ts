import type { OpenRepoResult } from '#/renderer/stores/repos/types.ts'

interface Options {
  openRepo: (path: string, options?: { activate?: boolean }) => Promise<OpenRepoResult>
  setActive: (id: string) => void
  onOpenFailed?: (path: string, message: string) => void
}

export async function openRepoPaths(paths: string[], { openRepo, setActive, onOpenFailed }: Options): Promise<string | null> {
  let firstId: string | null = null
  for (const path of paths) {
    const result = await openRepo(path, { activate: false })
    if (!result.ok) {
      onOpenFailed?.(path, result.message)
      continue
    }
    firstId ??= result.id
  }
  if (firstId !== null) setActive(firstId)
  return firstId
}
