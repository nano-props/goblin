export type GitHead = { kind: 'branch'; branchName: string } | { kind: 'detached' }

export function gitHead(branchName: string | null): GitHead {
  return branchName === null ? { kind: 'detached' } : { kind: 'branch', branchName }
}

export function gitHeadBranch(head: GitHead): string | null {
  return head.kind === 'branch' ? head.branchName : null
}
