import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'
import { toast } from 'sonner'
import { Button } from '#/web/components/ui/button.tsx'
import { cn } from '#/web/lib/cn.ts'
import { setTerminalFocused } from '#/web/terminal-focus.ts'
import { collectClipboardFiles } from '#/web/clipboard/collect-clipboard-files.ts'
import { processDrop, processPaste } from '#/web/clipboard/process.ts'
import { PASTE_FILE_MAX_BYTES } from '#/shared/clipboard-paste.ts'
import { useT } from '#/web/stores/i18n.ts'
import { terminalLog } from '#/web/logger.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import {
  useWorktreeTerminalSelectedDescriptor,
  useWorktreeTerminalCount,
  useTerminalSnapshot,
} from '#/web/components/terminal/terminal-session-store.ts'
import { MobileTerminalToolbar } from '#/web/components/terminal/mobile-terminal-toolbar.tsx'
import { isMobileDevice } from '#/web/components/terminal/mobile-detection.ts'
interface TerminalSlotProps {
  repoRoot: string
  branch: string
  worktreePath: string
}

export function TerminalSlot({ repoRoot, branch, worktreePath }: TerminalSlotProps) {
  const t = useT()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const context = useTerminalSessionContext()
  const {
    clearBell,
    attach,
    detach,
    registerHost,
    unregisterHost,
    scrollLines,
    isTerminalFocusTarget,
    findNext,
    findPrevious,
    clearSearch,
    writeInput,
    takeover,
    restart,
    createTerminal,
  } = context
  const terminalWorktreeKey = worktreeTerminalKey(repoRoot, worktreePath)
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    registerHost(terminalWorktreeKey, host)
    return () => unregisterHost(terminalWorktreeKey, host)
  }, [registerHost, terminalWorktreeKey, unregisterHost])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => registerHost(terminalWorktreeKey, host))
    observer.observe(host)
    return () => observer.disconnect()
  }, [registerHost, terminalWorktreeKey])

  const descriptor = useWorktreeTerminalSelectedDescriptor(terminalWorktreeKey)
  const key = descriptor?.key ?? null
  // `key` can change when the user switches worktrees mid-flight. The
  // paste/drop handlers capture it at invocation time; a ref tracks
  // the latest value so the post-resolve `.then` can detect a switch
  // and drop the write — the captured session is no longer the user's
  // focus, and the path landing in it would be invisible (or worse,
  // typed into a now-detached session).
  const keyRef = useRef<string | null>(key)
  useEffect(() => {
    keyRef.current = key
  }, [key])
  const snapshot = useTerminalSnapshot(key)
  const hasSessions = useWorktreeTerminalCount(terminalWorktreeKey) > 0

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || !descriptor) return
    attach(descriptor, host)
    return () => detach(descriptor.key, host)
  }, [attach, descriptor, detach])

  useEffect(() => {
    if (!key || typeof document === 'undefined' || !document.hasFocus()) return
    clearBell(key)
  }, [clearBell, key])

  useEffect(() => {
    if (!key) return
    const handleFocus = () => clearBell(key)
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [clearBell, key])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus({ preventScroll: true })
  }, [searchOpen])

  useEffect(() => {
    if (!searchOpen && key) clearSearch(key)
  }, [clearSearch, key, searchOpen])

  useEffect(() => {
    return () => {
      if (key) clearSearch(key)
    }
  }, [clearSearch, key])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchTerm('')
  }, [])
  const searchNext = useCallback(
    (term = searchTerm, incremental = false) => {
      if (!key) return
      findNext(key, term, incremental)
    },
    [findNext, key, searchTerm],
  )
  const searchPrevious = useCallback(() => {
    if (!key) return
    findPrevious(key, searchTerm)
  }, [findPrevious, key, searchTerm])
  const handleFocus = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      setTerminalFocused(!!key && isTerminalFocusTarget(key, event.target))
    },
    [isTerminalFocusTarget, key],
  )
  const handleBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTerminalFocused(false)
  }, [])
  const handleKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (isTerminalSearchShortcut(event)) {
        event.preventDefault()
        event.stopPropagation()
        setSearchOpen(true)
        return
      }
      if (searchOpen && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeSearch()
        return
      }
    },
    [closeSearch, searchOpen],
  )
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchTerm(value)
      searchNext(value, true)
    },
    [searchNext],
  )
  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        if (event.shiftKey) searchPrevious()
        else searchNext()
      }
    },
    [searchNext, searchPrevious],
  )
  const resultLabel =
    snapshot.search && searchTerm
      ? snapshot.search.resultCount > 0
        ? snapshot.search.resultIndex >= 0
          ? `${snapshot.search.resultIndex + 1}/${snapshot.search.resultCount}`
          : String(snapshot.search.resultCount)
        : t('terminal.search-no-results')
      : ''

  const [dragOver, setDragOver] = useState(false)
  const progress = snapshot.progress
  const attachment = snapshot.attachment
  // Slot mode is a small state machine. The previous two-flag design
  // (`isController` / `isReadonly`, both gated on `phase === 'open'`)
  // silently broke error-phase rendering: a viewer in error phase
  // would see neither the viewer overlay (open-gated) nor the
  // correctly-gated error chip, leaving the restart button visible
  // even though the server would reject the request. Modelling the
  // mode explicitly keeps the per-state UI rules in one place.
  //
  // Computed *before* the paste/drop handlers below so the handlers
  // share a single source of truth for the controller gate (the
  // `isController` derived flag). Earlier drafts kept a parallel
  // `earlyIsController = hasSessions && snapshot.phase === 'open'
  // && attachment?.role === 'controller'` near the handlers and
  // a separate `isController = slotMode === 'open-controller'`
  // definition below — those two stayed in sync by accident, not by
  // contract, and would have drifted the moment either side got
  // edited.
  const slotMode: 'opening' | 'restarting' | 'open-controller' | 'open-viewer' | 'error-controller' | 'error-viewer' =
    (() => {
      if (!hasSessions) return 'opening'
      if (snapshot.phase === 'opening') return 'opening'
      if (snapshot.phase === 'restarting') return 'restarting'
      if (snapshot.phase === 'error') {
        return attachment?.role === 'controller' ? 'error-controller' : 'error-viewer'
      }
      // phase === 'open'
      return attachment?.role === 'controller' ? 'open-controller' : 'open-viewer'
    })()
  // `isController` is the *interactive* affordance flag — it gates the
  // mobile toolbar, the paste/drop file handlers, and the xterm's
  // `aria-readonly`. The PTY is dead in `error-controller`, so we
  // deliberately exclude that state even though the controller status
  // is still ours. The error chip is shown via `showErrorChip`
  // instead.
  const isController = slotMode === 'open-controller'
  const isReadonly = slotMode === 'open-viewer' || slotMode === 'error-viewer'
  const showViewerOverlay = isReadonly
  const showErrorChip = slotMode === 'error-controller'
  const readonlyBadge = attachment?.role === 'viewer' ? t('terminal.mirror-controlled') : t('terminal.unowned')
  const progressVariant =
    progress?.state === 2 ? 'error' : progress?.state === 4 ? 'warning' : progress?.state === 3 ? 'indeterminate' : ''
  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setDragOver(true)
  }, [])
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])
  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    const relatedTarget = event.relatedTarget
    if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) setDragOver(false)
  }, [])
  const writeResolutionToPty = useCallback(
    (paths: string[], failed: number, sessionKey: string) => {
      if (paths.length === 0) {
        toast.error(t('terminal.paste-file-failed'))
        return
      }
      const escaped = paths.map(shellEscapePath).join(' ')
      writeInput(sessionKey, escaped)
      if (failed > 0) toast.error(t('terminal.paste-file-partial'))
    },
    [t, writeInput],
  )
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      setDragOver(false)
      // `isController` gate matches paste: a viewer dropping files into
      // a session it doesn't own would otherwise silently route input
      // to the controller's PTY. The `!key` half preserves the
      // pre-existing guard against slots with no session.
      if (!key || !isController) return
      const files = Array.from(event.dataTransfer.files).filter((f) => f.size > 0)
      if (files.length === 0) return
      // Capture the session key the user actually dropped into. The
      // blob-save tier (web HTTP path) is a real roundtrip, so a
      // worktree switch during resolve would otherwise route the
      // write to a session the user is no longer looking at.
      const sessionKey = key
      void processDrop({ files }).then((outcome) => {
        if (keyRef.current !== sessionKey) return
        // `no-op` is unreachable at this call site: `handleDrop`
        // filters zero-byte files before calling `processDrop`, so
        // `processDrop` can only return `files` or `too-large`.
        // `handlePasteCapture` uses the same if-narrowing shape.
        if (outcome.kind === 'files') {
          writeResolutionToPty(outcome.resolution.paths, outcome.resolution.failed, sessionKey)
          return
        }
        if (outcome.kind === 'too-large') {
          toast.error(t('terminal.paste-file-too-large'))
        }
      })
    },
    [isController, key, t, writeResolutionToPty],
  )
  const handlePasteCapture = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (!key || !isController) return
      const files = collectClipboardFiles(event.clipboardData)
      // Files-first: a Linux file copy carries both `text/uri-list`
      // and a `text/plain` rendering of the same URI list. If we let
      // text win, the user pastes a literal `file:///…` string.
      if (files.length > 0) {
        if (files.some((f) => f.size > PASTE_FILE_MAX_BYTES)) {
          event.preventDefault()
          toast.error(t('terminal.paste-file-too-large'))
          return
        }
        // preventDefault() in capture phase is enough to stop xterm —
        // xterm renders inside this slot's root, so the bubble-phase
        // listener never sees the event. Do NOT call stopPropagation:
        // it would silently break any future bubble-phase paste
        // listener mounted higher in the tree.
        event.preventDefault()
        // Capture the session key the user pasted into. See
        // `handleDrop` for the worktree-switch rationale.
        const sessionKey = key
        void processPaste({ files }).then((outcome) => {
          if (keyRef.current !== sessionKey) return
          if (outcome.kind === 'files') {
            writeResolutionToPty(outcome.resolution.paths, outcome.resolution.failed, sessionKey)
            return
          }
          if (outcome.kind === 'too-large') {
            toast.error(t('terminal.paste-file-too-large'))
          }
        })
        return
      }
      // No files: let xterm handle text paste as today. Do NOT
      // preventDefault — that would block xterm's own text path.
    },
    [isController, key, t, writeResolutionToPty],
  )

  return (
    <div
      className="goblin-terminal-slot focus-visible:outline-none"
      tabIndex={-1}
      onFocusCapture={handleFocus}
      onBlurCapture={handleBlur}
      onKeyDownCapture={handleKeyDownCapture}
      onPasteCapture={handlePasteCapture}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {progress && (
        <div
          className={cn('goblin-terminal-progress', progressVariant && `goblin-terminal-progress--${progressVariant}`)}
          role="progressbar"
          aria-label={t('terminal.progress')}
          aria-valuenow={progress.state === 3 ? undefined : progress.value}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-busy={progress.state === 3 ? true : undefined}
        >
          {progress.state !== 3 && (
            <div className="goblin-terminal-progress__bar" style={{ width: `${progress.value}%` }} />
          )}
        </div>
      )}
      <div
        ref={hostRef}
        className={cn('goblin-terminal-slot__host', isReadonly && 'goblin-terminal-slot__host--hidden')}
        aria-readonly={(!isController && hasSessions) || undefined}
      />
      {searchOpen && (
        <div className="goblin-terminal-slot__search">
          <input
            ref={searchInputRef}
            className="goblin-terminal-slot__search-input"
            value={searchTerm}
            aria-label={t('terminal.search-placeholder')}
            placeholder={t('terminal.search-placeholder')}
            onChange={(event) => handleSearchChange(event.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <span className="goblin-terminal-slot__search-result" role="status" aria-live="polite" aria-atomic="true">
            {resultLabel}
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={searchPrevious} disabled={!searchTerm}>
            {t('terminal.search-previous')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => searchNext()} disabled={!searchTerm}>
            {t('terminal.search-next')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={closeSearch}>
            {t('terminal.search-close')}
          </Button>
        </div>
      )}
      {isMobileDevice() && isController && key && (
        <MobileTerminalToolbar
          className="goblin-terminal-mobile-toolbar--floating"
          onInput={(data) => writeInput(key, data)}
          onScrollLines={(amount) => scrollLines(key, amount)}
        />
      )}
      {showViewerOverlay && (
        <ViewerOverlay
          badge={readonlyBadge}
          takeoverLabel={t('terminal.takeover')}
          snapshot={snapshot}
          takeoverKey={key}
          onTakeover={(takeoverKey) => {
            // `takeover` returns `false` when the server rejected the
            // request — most commonly because the session is owned by
            // a different Goblin client (separate clientId). The user
            // clicked 「接管」 expecting to gain control; without this
            // toast the failure is silent and looks like a bug.
            //
            // We can't reliably tell "session vanished" from
            // "cross-clientId partition" on the renderer side — both
            // fail with `error.invalid-arguments` server-side. The
            // fallback hint points the user at the actual cause (the
            // other Goblin client window), which is right in the
            // dominant case and harmless in the rare one.
            void takeover(takeoverKey).then((ok) => {
              if (ok) return
              toast.error(t('action.result-error'), {
                description: t('terminal.takeover-failed'),
              })
            })
          }}
          takeoverPending={snapshot.takeoverPending}
        />
      )}
      {slotMode === 'opening' && !hasSessions ? (
        // Empty state: the worktree has no terminals yet. The bare
        // host <div> renders a featureless black box otherwise, which
        // is what the user reported as "blank screen" on the first
        // click. Render an explicit CTA so the affordance is
        // discoverable. The button is disabled while the create is
        // in flight (we await `createTerminal`'s returned key to
        // keep double-clicks idempotent — the registry dedupes by
        // worktree via the pending-create queue, but a visible
        // loading state is still the right user signal).
        <EmptyTerminalCta
          onCreate={async () => {
            try {
              await createTerminal({ repoRoot, branch, worktreePath })
            } catch (err) {
              terminalLog.warn('empty-state terminal create failed', { err })
              toast.error(t('error.terminal-create-failed'))
            }
          }}
          emptyLabel={t('terminal.empty')}
          newTerminalLabel={t('terminal.new')}
        />
      ) : slotMode === 'opening' || slotMode === 'restarting' ? (
        <div className="goblin-terminal-slot__status-overlay">
          <span>{t('terminal.opening')}</span>
        </div>
      ) : null}
      {/* Error-state rendering is mode-driven: only the controller sees
          the error chip with a working restart button; a viewer in
          error state must takeover first (the viewer overlay covers
          that path), so we suppress the chip rather than stack two
          overlays. The empty-message case is reserved for the
          "no sessions yet" placeholder and never renders the chip. */}
      {showErrorChip && snapshot.message !== 'terminal.empty' && (
        <div className="goblin-terminal-slot__status-overlay goblin-terminal-slot__status-overlay--error">
          <span>{t(snapshot.message ?? 'error.unknown')}</span>
          {key && (
            <Button type="button" size="sm" variant="ghost" onClick={() => restart(key)}>
              {t('terminal.restart')}
            </Button>
          )}
        </div>
      )}
      {dragOver && (
        <div className="goblin-terminal-slot__drop-overlay">
          <span>{t('terminal.drop-hint')}</span>
        </div>
      )}
    </div>
  )
}

interface ViewerOverlayProps {
  badge: string
  takeoverLabel: string
  snapshot: ReturnType<typeof useTerminalSnapshot>
  takeoverKey: string | null
  onTakeover: (key: string) => unknown
  takeoverPending?: boolean
}

interface EmptyTerminalCtaProps {
  onCreate: () => Promise<void> | void
  emptyLabel: string
  newTerminalLabel: string
}

// Empty-state CTA. Rendered when the worktree has no terminal
// sessions yet. The button is the only way for the user to
// materialize a session on a fresh worktree without reaching for
// the per-worktree "+" affordance in the tab strip — the slot's
// bare host <div> would otherwise be a featureless black box, which
// is the "blank screen" symptom the user reported on first click.
//
// `creating` is local to the button so double-clicks don't enqueue
// a second create while the first one is in flight. The registry's
// pending-create queue would dedupe the second call by worktree
// key, but a visible loading state is still the right user signal.
function EmptyTerminalCta({ onCreate, emptyLabel, newTerminalLabel }: EmptyTerminalCtaProps) {
  const [creating, setCreating] = useState(false)
  const handleClick = useCallback(async () => {
    if (creating) return
    setCreating(true)
    try {
      await onCreate()
    } finally {
      setCreating(false)
    }
  }, [creating, onCreate])
  return (
    <div className="goblin-terminal-slot__empty-cta" role="region" aria-label={emptyLabel}>
      <div className="goblin-terminal-slot__empty-message">
        <span className="goblin-terminal-slot__empty-title">{emptyLabel}</span>
      </div>
      <Button type="button" size="sm" variant="secondary" onClick={handleClick} disabled={creating}>
        {creating ? `${newTerminalLabel}…` : newTerminalLabel}
      </Button>
    </div>
  )
}

function ViewerOverlay({
  badge,
  takeoverLabel,
  snapshot,
  takeoverKey,
  onTakeover,
  takeoverPending,
}: ViewerOverlayProps) {
  return (
    <div className="goblin-terminal-slot__viewer-overlay">
      <div className="goblin-terminal-slot__viewer-content">
        <div className="goblin-terminal-slot__viewer-badge">{badge}</div>
        <div className="goblin-terminal-slot__viewer-meta">
          <span className="goblin-terminal-slot__viewer-process">{snapshot.processName}</span>
          {snapshot.canonicalTitle && (
            <span className="goblin-terminal-slot__viewer-title">{snapshot.canonicalTitle}</span>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => takeoverKey && onTakeover(takeoverKey)}
          disabled={!takeoverKey || takeoverPending}
        >
          {takeoverPending ? `${takeoverLabel}…` : takeoverLabel}
        </Button>
      </div>
    </div>
  )
}

function isTerminalSearchShortcut(event: KeyboardEvent<HTMLDivElement>): boolean {
  if (event.altKey || event.key.toLowerCase() !== 'f') return false
  return event.metaKey || (event.ctrlKey && event.shiftKey)
}

function shellEscapePath(path: string): string {
  if (path.length === 0) return "''"
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(path)) return path
  return "'" + path.replace(/'/g, "'\\''") + "'"
}
