import { BrowserWindow, Notification, app, ipcMain } from 'electron'
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
import {
  isValidTerminalNotifyBellInput,
  isValidTerminalSize,
  type TerminalMutationResult,
  type TerminalNotifyBellInput,
  type TerminalOpenInput,
  type TerminalOpenResult,
  type TerminalPruneRepoInput,
  type TerminalResizeInput,
  type TerminalRestartInput,
  type TerminalSessionInput,
  type TerminalWriteInput,
} from '#/shared/terminal.ts'

const MAX_TERMINAL_PRUNE_WORKTREES = 1000
const TERMINAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

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
  ipcMain.handle('goblin:terminal-notify-bell', (event, input: TerminalNotifyBellInput): TerminalMutationResult => {
    if (!isTrustedIpcEvent(event) || !isValidTerminalNotifyBellInput(input)) return false
    return notifyTerminalBell(event.sender, input)
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
    !isValidTerminalId(input?.terminalId) ||
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
    key: sessionKey(repoRoot, worktreePath, input.terminalId),
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

function isValidTerminalWorktreePathList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= MAX_TERMINAL_PRUNE_WORKTREES &&
    value.every((pathValue) => typeof pathValue === 'string' && isValidAbsolutePath(pathValue))
  )
}

function isValidTerminalId(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_ID_RE.test(value)
}

function sessionKey(repoRoot: string, worktreePath: string, terminalId?: string): string {
  return terminalId ? `${repoRoot}\0${worktreePath}\0${terminalId}` : `${repoRoot}\0${worktreePath}`
}

function notifyTerminalBell(webContents: WebContents, input: TerminalNotifyBellInput): boolean {
  const win = BrowserWindow.fromWebContents(webContents)
  if (!win || win.isDestroyed() || webContents.isDestroyed()) return false
  try {
    if (!win.isFocused()) {
      win.flashFrame(true)
      setTimeout(() => {
        try {
          if (!win.isDestroyed()) win.flashFrame(false)
        } catch {}
      }, 1500)
    }
    if (process.platform === 'darwin') app.dock?.bounce('informational')
    if (Notification.isSupported()) new Notification({ title: input.title, body: input.body, silent: true }).show()
    return true
  } catch (err) {
    console.warn('[terminal] failed to show bell notification', err)
    return false
  }
}
