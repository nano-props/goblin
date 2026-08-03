import { REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS } from '#/system/ssh/worktree-bootstrap-protocol.ts'

// Production only decodes this remote stream; tests need a byte-exact fixture encoder.
export function encodeRemoteWorktreeBootstrapRecord(
  kind: keyof typeof REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS,
  value: string,
): string {
  return `${REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS[kind]}\0${value}\0`
}
