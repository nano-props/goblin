import type { OpenRepoResult } from '#/web/stores/repos/types.ts'
interface Options {
  ensureWorkspaceOpen: (path: string) => Promise<OpenRepoResult>
  activateRepo?: (id: string) => void
  onOpenFailed?: (path: string, message: string) => void
}

export async function openRepoPaths(
  paths: string[],
  { ensureWorkspaceOpen, activateRepo, onOpenFailed }: Options,
): Promise<string | null> {
  let firstId: string | null = null
  for (const path of paths) {
    const result = await ensureWorkspaceOpen(path)
    if (!result.ok) {
      onOpenFailed?.(path, result.message)
      continue
    }
    firstId ??= result.id
  }
  if (firstId !== null) activateRepo?.(firstId)
  return firstId
}
