import script from '#/system/ssh/remote-worktree-bootstrap.sh' with { type: 'text' }

export function loadRemoteWorktreeBootstrapScript(): string {
  return script
}
