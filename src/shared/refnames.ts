export function validateBranchName(branch: string): { ok: true } | { ok: false } {
  if (
    branch === 'HEAD' ||
    branch.startsWith('-') ||
    !isSafeRefName(branch)
  ) {
    return { ok: false }
  }
  return { ok: true }
}

export function isSafeBranchName(branch: string): boolean {
  return validateBranchName(branch).ok
}

export function isSafeRefName(ref: string): boolean {
  if (
    ref.length === 0 ||
    ref.startsWith('/') ||
    ref.endsWith('/') ||
    ref.endsWith('.') ||
    ref.includes('//') ||
    ref.includes('..') ||
    ref.includes('@{') ||
    /[\u0000-\u0020\u007f~^:?*[\\]/.test(ref)
  ) {
    return false
  }
  return ref.split('/').every((part) => part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock'))
}

export function isSafeRemoteName(remote: string): boolean {
  return isSafeRefName(`refs/remotes/${remote}/test`)
}
