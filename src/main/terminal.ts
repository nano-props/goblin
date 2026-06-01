import { BrowserWindow, Notification, app, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import path from 'node:path'
import { broadcastRpcEvent } from '#/main/events.ts'
import { activateMainWindow } from '#/main/window.ts'
import { t } from '#/main/i18n/index.ts'
import { getWorktrees } from '#/main/git/worktrees.ts'
import { resolveKnownWorktree } from '#/main/git/guards.ts'
import { isValidAbsolutePath, isValidBranch, isValidCwd } from '#/main/ipc/validation.ts'
import { parseRemoteRepoId, normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import { buildRemoteTerminalInvocation } from '#/main/ssh/commands.ts'
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
  ipcMain.handle('goblin:terminal-notify-bell', async (event, input: TerminalNotifyBellInput): Promise<TerminalMutationResult> => {
    if (!isTrustedIpcEvent(event) || !isValidTerminalNotifyBellInput(input)) return false
    return notifyTerminalBell(event.sender, input)
  })
  ipcMain.handle('goblin:terminal-send-test-notification', async (event): Promise<boolean> => {
    if (!isTrustedIpcEvent(event)) return false
    if (!Notification.isSupported()) return false
    return showNotificationWithResult(
      t('settings.terminal-notifications-test-title'),
      t('settings.terminal-notifications-test-body'),
      null,
    )
  })
  ipcMain.on('goblin:terminal-set-badge', (event, count: unknown): void => {
    if (!isTrustedIpcEvent(event)) return
    const n = typeof count === 'number' && Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0
    if (process.platform === 'darwin') app.dock?.setBadge(n > 0 ? String(n) : '')
  })

  wireTerminalSessionCleanup()
}

async function openGoblinWorktreeTerminal(
  ownerWebContentsId: number,
  input: TerminalOpenInput,
  options: { restart?: boolean } = {},
): Promise<TerminalOpenResult> {
  const isRemote = input?.repoRoot?.startsWith('ssh://') ?? false
  if (
    (!isRemote && !isValidCwd(input?.repoRoot)) ||
    !isValidBranch(input?.branch) ||
    (!isRemote && !isValidAbsolutePath(input?.worktreePath)) ||
    (isRemote && (!input.worktreePath || input.worktreePath.includes('\0'))) ||
    !isValidTerminalId(input?.terminalId) ||
    !isValidTerminalSize(input?.cols, input?.rows)
  ) {
    return { ok: false, message: 'error.invalid-arguments' }
  }

  // Remote repository: launch SSH session instead of local shell
  if (isRemote) {
    const parsed = parseRemoteRepoId(input.repoRoot)
    if (!parsed) return { ok: false, message: 'error.invalid-arguments' }
    const target = normalizeRemoteTarget({ ...parsed, alias: null })
    if (!target) return { ok: false, message: 'error.invalid-arguments' }
    const invocation = buildRemoteTerminalInvocation(target, input.worktreePath, { cols: input.cols, rows: input.rows })
    return openTerminalSession({
      ownerWebContentsId,
      scope: input.repoRoot,
      key: sessionKey(input.repoRoot, input.worktreePath, input.terminalId),
      cwd: process.cwd(),
      cols: input.cols,
      rows: input.rows,
      forceNew: options.restart === true,
      command: invocation.command,
      args: invocation.args,
    })
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
  const isRemote = repoRoot.startsWith('ssh://')
  const resolvedRoot = isRemote ? repoRoot : path.resolve(repoRoot)
  const resolvedWorktree = isRemote ? worktreePath : path.resolve(worktreePath)
  closeTerminalKey(sessionKey(resolvedRoot, resolvedWorktree))
}

export function pruneRepoSessions(ownerWebContentsId: number, repoRoot: string, worktreePaths: string[]): void {
  const isRemote = repoRoot.startsWith('ssh://')
  const root = isRemote ? repoRoot : path.resolve(repoRoot)
  const liveKeys = new Set(
    worktreePaths
      .filter((p) => (isRemote ? !p.includes('\0') : isValidAbsolutePath(p)))
      .map((p) => sessionKey(root, isRemote ? p : path.resolve(p))),
  )
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

// How long to wait for a 'show' or 'failed' event before treating the
// notification as failed. In practice 'show' fires synchronously on macOS,
// so this only kicks in if neither event fires at all (shouldn't happen in
// normal operation, but guards against a permanent IPC hang).
const NOTIFICATION_SHOW_TIMEOUT_MS = 5000

async function notifyTerminalBell(webContents: WebContents, input: TerminalNotifyBellInput): Promise<boolean> {
  const win = BrowserWindow.fromWebContents(webContents)
  if (!win || win.isDestroyed() || webContents.isDestroyed()) return false
  try {
    // flashFrame and dock bounce are independent attention cues that work even
    // when system notifications are blocked (e.g. permission denied). They run
    // unconditionally so background terminal activity is never completely silent
    // regardless of notification settings.
    if (!win.isFocused()) {
      win.flashFrame(true)
      setTimeout(() => {
        try {
          if (!win.isDestroyed()) win.flashFrame(false)
        } catch {}
      }, 1500)
    }
    if (process.platform === 'darwin') app.dock?.bounce('informational')
    // flashFrame and dock bounce already delivered the attention cue above.
    // If system notifications are unsupported we still return true — the user
    // was notified via those mechanisms, so the bell was not silently dropped.
    if (!Notification.isSupported()) return true
    // showNotificationWithResult is async: it waits for the 'show' or 'failed'
    // event so the caller gets an accurate result instead of an optimistic true.
    return await showNotificationWithResult(input.title, input.body, input.repoRoot)
  } catch (err) {
    console.warn('[terminal] failed to show bell notification', err)
    return false
  }
}

// On macOS, Notification.show() is NOT a reliable signal of delivery on its
// own — calling show() returns immediately regardless of whether the system
// will actually display the notification.
//
// The correct way to detect failure is to listen for the 'failed' event, which
// Electron emits (via UNUserNotificationCenter's completion handler) when:
//   - the app binary is unsigned (common in development builds), or
//   - the user has denied notification permission for this app.
//
// We race 'show' vs 'failed' and resolve accordingly. The timeout is a last
// resort: in practice one of the two events always fires, but it prevents the
// IPC call from hanging indefinitely if neither does.
//
// silent: true suppresses the system sound; the bell audio (if any) is handled
// separately by the renderer's terminal emulator, not the OS notification.
function showNotificationWithResult(
  title: string,
  body: string,
  repoRoot: string | null,
): Promise<boolean> {
  return new Promise((resolve) => {
    const notif = new Notification({ title, body, silent: true })
    let settled = false
    const settle = (result: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => settle(false), NOTIFICATION_SHOW_TIMEOUT_MS)
    notif.once('show', () => settle(true))
    notif.once('failed', () => settle(false))
    notif.once('click', () => {
      // Bring the window to the foreground, then tell the renderer to switch
      // to the repo and open the terminal tab (only when repoRoot is known).
      void activateMainWindow().catch(() => {})
      if (repoRoot) broadcastRpcEvent({ type: 'terminal-bell-click', repoRoot })
    })
    notif.show()
  })
}
