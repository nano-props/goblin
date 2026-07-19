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
import { collectClipboardFiles, isNonPlaceholderClipboardFile } from '#/web/clipboard/collect-clipboard-files.ts'
import { previewPaste, processDrop } from '#/web/clipboard/process.ts'
import { resolvePastedFiles } from '#/web/clipboard/resolver.ts'
import { planTerminalPathWrite } from '#/web/clipboard/terminal-path-write.ts'
import type { PasteResolution } from '#/web/clipboard/resolver.ts'
import { useT } from '#/web/stores/i18n.ts'
import { terminalLog } from '#/web/logger.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import {
  useTerminalWorktreeSelectedDescriptor,
  useTerminalWorktreeSessionDescriptor,
  useTerminalWorktreeCount,
  useTerminalWorktreeCreatePending,
  useTerminalSnapshot,
} from '#/web/components/terminal/terminal-session-store.ts'
import { MobileTerminalToolbar } from '#/web/components/terminal/mobile-terminal-toolbar.tsx'
import { isMobileDevice } from '#/web/components/terminal/mobile-detection.ts'
import { terminalSessionCoordinates, type TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { TerminalProjectionHydrationPhase } from '#/web/stores/terminal-projection-hydration.ts'

const DEFAULT_TERMINAL_ERROR_MESSAGE_KEY = 'error.unknown'

interface TerminalSessionViewProps {
  base: TerminalSessionBase
  selectedTerminalSessionId?: string | null
  projectionPhase?: TerminalProjectionHydrationPhase
  projectionErrorMessage?: string
  createTerminalForSlot: (base: TerminalSessionBase) => Promise<unknown>
}

export function TerminalSessionView({
  base,
  selectedTerminalSessionId,
  projectionPhase = 'ready',
  projectionErrorMessage,
  createTerminalForSlot,
}: TerminalSessionViewProps) {
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
    focusTerminal,
  } = context
  const { workspaceId, worktreeId } = terminalSessionCoordinates(base)
  const terminalWorktreeKey = formatTerminalWorktreeKey(workspaceId, worktreeId)
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

  const selectedDescriptor = useTerminalWorktreeSelectedDescriptor(terminalWorktreeKey)
  const explicitDescriptor = useTerminalWorktreeSessionDescriptor({
    terminalWorktreeKey,
    terminalSessionId: selectedTerminalSessionId ?? null,
    base,
  })
  const descriptor = selectedTerminalSessionId === undefined ? selectedDescriptor : explicitDescriptor
  const terminalSessionId =
    selectedTerminalSessionId === undefined
      ? (selectedDescriptor?.terminalSessionId ?? null)
      : selectedTerminalSessionId
  // The descriptor is server projection metadata. Keep the latest value
  // available for attach, but do not let metadata-only changes such as tab
  // reorder/index updates drive the xterm mount lifecycle.
  const descriptorRef = useRef(descriptor)
  useLayoutEffect(() => {
    descriptorRef.current = descriptor
  }, [descriptor])
  const snapshot = useTerminalSnapshot(terminalSessionId)
  const hasSessions = useTerminalWorktreeCount(terminalWorktreeKey) > 0
  const createPending = useTerminalWorktreeCreatePending(terminalWorktreeKey)

  useLayoutEffect(() => {
    const host = hostRef.current
    const selectedDescriptor = descriptorRef.current
    if (!host || !selectedDescriptor || selectedDescriptor.terminalSessionId !== terminalSessionId) return
    attach(selectedDescriptor, host)
    return () => detach(selectedDescriptor.terminalSessionId, host)
  }, [attach, detach, terminalSessionId])

  useEffect(() => {
    if (!terminalSessionId || typeof document === 'undefined' || !document.hasFocus()) return
    clearBell(terminalSessionId)
  }, [clearBell, terminalSessionId])

  useEffect(() => {
    if (!terminalSessionId) return
    const handleFocus = () => clearBell(terminalSessionId)
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [clearBell, terminalSessionId])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus({ preventScroll: true })
  }, [searchOpen])

  useEffect(() => {
    if (!searchOpen && terminalSessionId) clearSearch(terminalSessionId)
  }, [clearSearch, terminalSessionId, searchOpen])

  useEffect(() => {
    return () => {
      if (terminalSessionId) clearSearch(terminalSessionId)
    }
  }, [clearSearch, terminalSessionId])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchTerm('')
  }, [])
  const searchNext = useCallback(
    (term = searchTerm, incremental = false) => {
      if (!terminalSessionId) return
      findNext(terminalSessionId, term, incremental)
    },
    [findNext, terminalSessionId, searchTerm],
  )
  const searchPrevious = useCallback(() => {
    if (!terminalSessionId) return
    findPrevious(terminalSessionId, searchTerm)
  }, [findPrevious, terminalSessionId, searchTerm])
  const handleFocus = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      setTerminalFocused(!!terminalSessionId && isTerminalFocusTarget(terminalSessionId, event.target))
    },
    [isTerminalFocusTarget, terminalSessionId],
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
  // Session mode is a small state machine. The previous two-flag design
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
  // a separate `isController = sessionPhase === 'open-controller'`
  // definition below — those two stayed in sync by accident, not by
  // contract, and would have drifted the moment either side got
  // edited.
  const sessionPhase:
    'opening' | 'restarting' | 'open-controller' | 'open-viewer' | 'error-controller' | 'error-viewer' = (() => {
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
  const isController = sessionPhase === 'open-controller'
  const isReadonly = sessionPhase === 'open-viewer' || sessionPhase === 'error-viewer'
  const isAttaching = sessionPhase === 'opening' || sessionPhase === 'restarting'
  const hideTerminalHost = isReadonly || (hasSessions && isAttaching)
  const showViewerOverlay = isReadonly
  const showErrorChip = sessionPhase === 'error-controller'
  const terminalErrorMessageKey = snapshot.message ?? DEFAULT_TERMINAL_ERROR_MESSAGE_KEY
  const readonlyBadge = attachment?.role === 'viewer' ? t('terminal.mirror-controlled') : t('terminal.unowned')
  // Status-chip visibility is derived here (not in a JSX branch chain)
  // so the chip's mount identity stays stable across the `!hasSessions`
  // ↔ `hasSessions` flip during a normal terminal open. Stable mount
  // prevents mount-orchestrated aria-live re-announcement; text-change
  // re-announcement is still possible when the label transitions within
  // the same node (e.g. `Loading…` → `Opening…` when `projectionPhase` flips),
  // which is the standard polite-live-region contract.
  const projectionPending = projectionPhase === 'pending'
  const projectionFailed = projectionPhase === 'failed'
  const showEmptyCta = sessionPhase === 'opening' && !hasSessions && projectionPhase === 'ready' && !createPending
  const showStatusOverlay = isAttaching && !showEmptyCta
  const statusOverlayLabel =
    sessionPhase === 'restarting'
      ? t('terminal.restarting')
      : sessionPhase === 'opening' && !hasSessions && projectionPending
        ? t('terminal.loading')
        : sessionPhase === 'opening' && !hasSessions && projectionFailed
          ? projectionErrorMessage
            ? `${t('terminal.load-failed')} (${projectionErrorMessage})`
            : t('terminal.load-failed')
          : t('terminal.opening')
  const progressVariant =
    progress?.state === 2 ? 'error' : progress?.state === 4 ? 'warning' : progress?.state === 3 ? 'indeterminate' : ''
  const readyFocusedKeyRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    const ready = terminalSessionId !== null && sessionPhase === 'open-controller'
    if (!ready || !terminalSessionId) {
      if (readyFocusedKeyRef.current === terminalSessionId) readyFocusedKeyRef.current = null
      return
    }
    if (searchOpen || readyFocusedKeyRef.current === terminalSessionId) return
    focusTerminal(terminalSessionId)
    readyFocusedKeyRef.current = terminalSessionId
  }, [focusTerminal, terminalSessionId, searchOpen, sessionPhase])
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
    (resolution: PasteResolution, terminalSessionId: string, source: 'paste' | 'drop') => {
      const plan = planTerminalPathWrite(resolution.paths, {
        failedUnsafe: resolution.failedUnsafe,
        failedBackend: resolution.failedBackend,
      })
      if (plan.kind === 'none') {
        if (plan.failures.failedUnsafe > 0) toast.error(t('terminal.paste-file-unsafe'))
        if (plan.failures.failedBackend > 0) toast.error(t('terminal.paste-file-failed'))
        return
      }
      if (plan.kind === 'too-long') {
        toast.error(t('terminal.paste-file-overflow'))
        return
      }
      writeInput(terminalSessionId, plan.data, source)
      if (plan.failures.failedUnsafe > 0) toast.error(t('terminal.paste-file-unsafe'))
      if (plan.failures.failedBackend > 0) toast.error(t('terminal.paste-file-partial'))
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
      // to the controller's PTY. The `!terminalSessionId` half preserves the
      // pre-existing guard against sessions with no session.
      if (!terminalSessionId || !isController) return
      const files = Array.from(event.dataTransfer.files).filter(isNonPlaceholderClipboardFile)
      if (files.length === 0) return
      // Capture the terminal session the user actually dropped into. Async
      // file resolution may finish after the user changes panes, but the
      // operation's target was fixed by the drop event.
      const capturedSessionId = terminalSessionId
      void processDrop({ files }).then(
        (outcome) => {
          // `no-op` is unreachable at this call site: `handleDrop`
          // filters zero-byte files before calling `processDrop`, so
          // `processDrop` can only return `files` or `too-large`.
          // `handlePasteCapture` uses the same if-narrowing shape.
          if (outcome.kind === 'files') {
            writeResolutionToPty(outcome.resolution, capturedSessionId, 'drop')
            return
          }
          if (outcome.kind === 'too-large') {
            toast.error(t('terminal.paste-file-too-large'))
          }
        },
        (err) => {
          // IPC / network / server failure. Surface it instead of
          // silently swallowing the rejection.
          terminalLog.warn('drop resolver failed', { err })
          toast.error(t('terminal.paste-file-failed'))
        },
      )
    },
    [isController, terminalSessionId, t, writeResolutionToPty],
  )
  const handlePasteCapture = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (!terminalSessionId || !isController) return
      const clipboardData = event.clipboardData
      if (!clipboardData) return

      // Synchronous routing. The capture-phase listener must call
      // preventDefault/stopPropagation BEFORE awaiting anything,
      // because xterm.js's descendant textarea listener fires
      // immediately after us.
      const files = collectClipboardFiles(clipboardData)
      const text = clipboardData.getData('text/plain')
      const preview = previewPaste({ text, files })

      // Text wins → defer to xterm.js's native paste handler. It
      // reads `text/plain` itself and wraps with bracketed-paste
      // sequences when the shell has enabled mode 2004. We do NOT
      // preventDefault here so the native path runs. The file
      // blobs on the same event (e.g. Excel's incidental thumbnail)
      // are discarded — see `shouldPreferFilesOverText`.
      if (preview.kind === 'text') return
      if (preview.kind === 'no-op') return

      // From here we own the paste. `stopPropagation` (not just
      // `preventDefault`) is what stops xterm.js's descendant
      // listener from also writing the text/plain content (URI list
      // from Linux file copy, or single-line path text from
      // Windows file copy) to the PTY in addition to our
      // shell-escaped path.
      event.preventDefault()
      event.stopPropagation()

      if (preview.kind === 'too-large') {
        toast.error(t('terminal.paste-file-too-large'))
        return
      }

      // 'files' — resolve paths asynchronously. Capture the terminal
      // session id selected by the paste event.
      const capturedSessionId = terminalSessionId
      void resolvePastedFiles(files).then(
        (resolution) => {
          writeResolutionToPty(resolution, capturedSessionId, 'paste')
        },
        (err) => {
          // IPC / network / server failure. Surface it instead of
          // silently swallowing the rejection — the user needs to
          // know their paste didn't land.
          terminalLog.warn('paste resolver failed', { err })
          toast.error(t('terminal.paste-file-failed'))
        },
      )
    },
    [isController, terminalSessionId, t, writeResolutionToPty],
  )

  return (
    <div
      className="goblin-terminal-session focus-visible:outline-none"
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
        className={cn('goblin-terminal-session__host', hideTerminalHost && 'goblin-terminal-session__host--hidden')}
        aria-readonly={(!isController && hasSessions) || undefined}
      />
      {searchOpen && (
        <div className="goblin-terminal-session__search">
          <input
            ref={searchInputRef}
            className="goblin-terminal-session__search-input"
            value={searchTerm}
            aria-label={t('terminal.search-placeholder')}
            placeholder={t('terminal.search-placeholder')}
            onChange={(event) => handleSearchChange(event.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <span className="goblin-terminal-session__search-result" role="status" aria-live="polite" aria-atomic="true">
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
      {isMobileDevice() && isController && terminalSessionId && (
        <MobileTerminalToolbar
          className="goblin-terminal-mobile-toolbar--floating"
          onInput={(data) => writeInput(terminalSessionId, data, 'toolbar')}
          onScrollLines={(amount) => scrollLines(terminalSessionId, amount)}
        />
      )}
      {showViewerOverlay && (
        <ViewerOverlay
          badge={readonlyBadge}
          takeoverLabel={t('terminal.takeover')}
          snapshot={snapshot}
          takeoverSessionId={terminalSessionId}
          onTakeover={(takeoverSessionId) => {
            // `takeover` returns `false` when the server rejected the
            // request. The client cannot reliably distinguish a
            // closed session from an attachment that has not connected
            // yet, so surface a concise retry hint instead of silently
            // clearing the pending state.
            void takeover(takeoverSessionId).then((ok) => {
              if (ok) return
              toast.error(t('action.result-error'), {
                description: t('terminal.takeover-failed'),
              })
            })
          }}
          takeoverPending={snapshot.takeoverPending}
        />
      )}
      {/* Stable mount — see the constants block above for the aria-live rationale. */}
      {showStatusOverlay && <StatusOverlay label={statusOverlayLabel} />}
      {showEmptyCta && (
        // Empty state: the worktree has no terminals yet. The bare
        // host <div> renders a featureless black box otherwise, which
        // is what the user reported as "blank screen" on the first
        // click. Render an explicit CTA so the affordance is
        // discoverable. The button is disabled while the create is
        // in flight (we await `createTerminal`'s returned terminalSessionId to
        // keep double-clicks idempotent — the registry dedupes by
        // worktree via the pending-create queue, but a visible
        // loading state is still the right user signal).
        <EmptyTerminalCta
          onCreate={async () => {
            await createTerminalForSlot(base)
          }}
          emptyLabel={t('terminal.empty')}
          newTerminalLabel={t('terminal.new')}
        />
      )}
      {/* Error-state rendering is mode-driven: only the controller sees
          the error chip with a working restart button; a viewer in
          error state must takeover first (the viewer overlay covers
          that path), so we suppress the chip rather than stack two
          overlays. The empty-message case is reserved for the
          "no sessions yet" placeholder and never renders the chip. */}
      {showErrorChip && snapshot.message !== 'terminal.empty' && (
        <div className="goblin-terminal-session__status-overlay goblin-terminal-session__status-overlay--error">
          <span>{t(terminalErrorMessageKey)}</span>
          {terminalSessionId && (
            <Button type="button" size="sm" variant="ghost" onClick={() => restart(terminalSessionId)}>
              {t('terminal.restart')}
            </Button>
          )}
        </div>
      )}
      {dragOver && (
        <div className="goblin-terminal-session__drop-overlay">
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
  takeoverSessionId: string | null
  onTakeover: (terminalSessionId: string) => unknown
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
// the per-worktree "+" affordance in the tab strip — the session's
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
    <div className="goblin-terminal-session__empty-cta" role="region" aria-label={emptyLabel}>
      <div className="goblin-terminal-session__empty-message">
        <span className="goblin-terminal-session__empty-title">{emptyLabel}</span>
      </div>
      <Button type="button" size="sm" variant="secondary" onClick={handleClick} disabled={creating}>
        {creating ? `${newTerminalLabel}…` : newTerminalLabel}
      </Button>
    </div>
  )
}

interface StatusOverlayProps {
  label: string
}

// Hoisted so clsx + tailwind-merge don't re-allocate per render.
const STATUS_DOT_CLASS = cn('goblin-terminal-session__status-dot', 'animate-pulse')

// Transient status chip rendered while a terminal is opening or
// restarting. See the `showStatusOverlay` derivation above for the
// aria-live contract (stable mount prevents mount-orchestrated
// re-announcement; label transitions within the same node still
// re-announce per the polite-live-region default).
function StatusOverlay({ label }: StatusOverlayProps) {
  return (
    <div className="goblin-terminal-session__status-overlay" role="status" aria-live="polite" aria-busy="true">
      <span className={STATUS_DOT_CLASS} />
      <span>{label}</span>
    </div>
  )
}

function ViewerOverlay({
  badge,
  takeoverLabel,
  snapshot,
  takeoverSessionId,
  onTakeover,
  takeoverPending,
}: ViewerOverlayProps) {
  return (
    <div className="goblin-terminal-session__viewer-overlay">
      <div className="goblin-terminal-session__viewer-content">
        <div className="goblin-terminal-session__viewer-badge">{badge}</div>
        <div className="goblin-terminal-session__viewer-meta">
          <span className="goblin-terminal-session__viewer-process">{snapshot.processName}</span>
          {snapshot.canonicalTitle && (
            <span className="goblin-terminal-session__viewer-title">{snapshot.canonicalTitle}</span>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => takeoverSessionId && onTakeover(takeoverSessionId)}
          disabled={!takeoverSessionId || takeoverPending}
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
