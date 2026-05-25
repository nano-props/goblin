import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import path from 'node:path'
import { getWorktrees } from '#/main/git/worktrees.ts'
import { resolveKnownWorktree } from '#/main/git/guards.ts'
import { isValidAbsolutePath, isValidBranch, isValidCwd } from '#/main/ipc/validation.ts'
import { isTrustedIpcEvent } from '#/main/ipc/trusted-webcontents.ts'
import {
  closeAllTerminalSessions,
  closeOwnedTerminalSession,
  closeTerminalKey,
  closeTerminalOwner,
  isValidTerminalSessionId,
  isValidTerminalWriteData,
  openTerminalSession,
  pruneTerminalScope,
  resizeTerminalSession,
  wireTerminalSessionCleanup,
  writeTerminalSession,
} from '#/main/terminal-core.ts'
import type {
  TerminalOpenInput,
  TerminalOpenResult,
  TerminalMutationResult,
  TerminalPruneRepoInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionInput,
  TerminalWriteInput,
} from '#/shared/terminal.ts'

const MAX_TERMINAL_PRUNE_WORKTREES = 1000
const MIN_TERMINAL_COLS = 1
const MAX_TERMINAL_COLS = 500
const MIN_TERMINAL_ROWS = 1
const MAX_TERMINAL_ROWS = 300

export { closeAllTerminalSessions } from '#/main/terminal-core.ts'

let wired = false

export function wireTerminalIpc(): void {
  if (wired) return
  wired = true

  ipcMain.handle('goblin:terminal-open', async (event, input: TerminalOpenInput): Promise<TerminalOpenResult> => {
    if (!isTrustedIpcEvent(event)) return { ok: false, message: 'error.invalid-arguments' }
    registerTerminalOwnerCleanup(event.sender)
    return openGoblinWorktreeTerminal(event.sender.id, input)
  })
  ipcMain.handle('goblin:terminal-restart', async (event, input: TerminalRestartInput): Promise<TerminalOpenResult> => {
    if (!isTrustedIpcEvent(event)) return { ok: false, message: 'error.invalid-arguments' }
    registerTerminalOwnerCleanup(event.sender)
    return openGoblinWorktreeTerminal(event.sender.id, input, { restart: true })
  })
  ipcMain.handle('goblin:terminal-write', (event, input: TerminalWriteInput): TerminalMutationResult => {
    if (!isTrustedIpcEvent(event)) return false
    if (!isValidTerminalSessionId(input?.sessionId) || !isValidTerminalWriteData(input?.data)) return false
    return writeTerminalSession(event.sender.id, input.sessionId, input.data)
  })
  ipcMain.handle('goblin:terminal-resize', (event, input: TerminalResizeInput): TerminalMutationResult => {
    if (!isTrustedIpcEvent(event)) return false
    if (!isValidTerminalSessionId(input?.sessionId) || !isValidTerminalSize(input?.cols, input?.rows)) return false
    return resizeTerminalSession(event.sender.id, input.sessionId, input.cols, input.rows)
  })
  ipcMain.handle('goblin:terminal-close', (event, input: TerminalSessionInput): TerminalMutationResult => {
    if (!isTrustedIpcEvent(event)) return false
    return isValidTerminalSessionId(input?.sessionId)
      ? closeOwnedTerminalSession(event.sender.id, input.sessionId)
      : false
  })
  ipcMain.handle('goblin:terminal-prune-repo', (event, input: TerminalPruneRepoInput): TerminalMutationResult => {
    if (!isTrustedIpcEvent(event)) return false
    if (!isValidCwd(input?.repoRoot) || !isValidTerminalWorktreePathList(input?.worktreePaths)) return false
    pruneRepoSessions(event.sender.id, input.repoRoot, input.worktreePaths)
    return true
  })

  wireTerminalSessionCleanup()
}

async function openGoblinWorktreeTerminal(
  ownerWebContentsId: number,
  input: TerminalOpenInput,
  options: { restart?: boolean } = {},
): Promise<TerminalOpenResult> {
  if (
    !isValidCwd(input?.repoRoot) ||
    !isValidBranch(input?.branch) ||
    !isValidAbsolutePath(input?.worktreePath) ||
    !isValidTerminalSize(input?.cols, input?.rows)
  ) {
    return { ok: false, message: 'error.invalid-arguments' }
  }

  const worktrees = await getWorktrees(input.repoRoot, { includeStatus: false })
  const resolved = resolveKnownWorktree(worktrees, input.worktreePath, input.branch)
  if (!resolved.ok) return resolved

  const repoRoot = path.resolve(input.repoRoot)
  const worktreePath = path.resolve(resolved.path)
  return openTerminalSession({
    ownerWebContentsId,
    scope: repoRoot,
    key: sessionKey(repoRoot, worktreePath),
    cwd: worktreePath,
    cols: input.cols,
    rows: input.rows,
    forceNew: options.restart === true,
  })
}

const terminalOwnerCleanupIds = new Set<number>()

function registerTerminalOwnerCleanup(webContents: WebContents): void {
  if (terminalOwnerCleanupIds.has(webContents.id)) return
  terminalOwnerCleanupIds.add(webContents.id)
  webContents.once('destroyed', () => {
    terminalOwnerCleanupIds.delete(webContents.id)
    closeTerminalOwner(webContents.id)
  })
}

export function closeWorktreeSession(repoRoot: string, worktreePath: string): void {
  closeTerminalKey(sessionKey(path.resolve(repoRoot), path.resolve(worktreePath)))
}

export function pruneRepoSessions(ownerWebContentsId: number, repoRoot: string, worktreePaths: string[]): void {
  const root = path.resolve(repoRoot)
  const liveKeys = new Set(worktreePaths.filter(isValidAbsolutePath).map((p) => sessionKey(root, path.resolve(p))))
  pruneTerminalScope(ownerWebContentsId, root, liveKeys)
}

function isValidTerminalSize(cols: unknown, rows: unknown): boolean {
  return (
    typeof cols === 'number' &&
    typeof rows === 'number' &&
    Number.isFinite(cols) &&
    Number.isFinite(rows) &&
    cols >= MIN_TERMINAL_COLS &&
    cols <= MAX_TERMINAL_COLS &&
    rows >= MIN_TERMINAL_ROWS &&
    rows <= MAX_TERMINAL_ROWS
  )
}

function isValidTerminalWorktreePathList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= MAX_TERMINAL_PRUNE_WORKTREES &&
    value.every((pathValue) => typeof pathValue === 'string' && isValidAbsolutePath(pathValue))
  )
}

function sessionKey(repoRoot: string, worktreePath: string): string {
  return `${repoRoot}\0${worktreePath}`
}
