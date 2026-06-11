export function worktreeTerminalKey(repoRoot: string, worktreePath: string): string {
  return `${repoRoot}\0${worktreePath}`
}

export function terminalSessionKey(repoRoot: string, worktreePath: string, terminalId: string): string {
  return `${worktreeTerminalKey(repoRoot, worktreePath)}\0${terminalId}`
}

export function parseTerminalSessionKey(key: string): { repoRoot: string; worktreePath: string; terminalId: string } | null {
  const parts = key.split('\0')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null
  return { repoRoot: parts[0], worktreePath: parts[1], terminalId: parts[2] }
}
