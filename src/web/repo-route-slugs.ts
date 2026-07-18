import { canonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'

export function repoSlugFromId(repoId: string): string {
  return slugFromText(repoId)
}

export function repoIdFromSlug(slug: string): string | null {
  return textFromSlug(slug)
}

export function workspaceIdFromSlug(slug: string): WorkspaceId | null {
  const decoded = repoIdFromSlug(slug)
  return decoded ? canonicalWorkspaceLocator(decoded) : null
}

export function branchSlugFromName(branchName: string): string {
  return slugFromText(branchName)
}

export function branchNameFromSlug(slug: string): string | null {
  return textFromSlug(slug)
}

export function worktreeSlugFromPath(worktreePath: string): string {
  return slugFromText(worktreePath)
}

export function worktreePathFromSlug(slug: string): string | null {
  return textFromSlug(slug)
}

function slugFromText(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function textFromSlug(slug: string): string | null {
  try {
    const padded = slug.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (slug.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}
