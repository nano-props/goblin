import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { toast } from 'sonner'
import { Button } from '#/web/components/ui/button.tsx'
import { cn } from '#/web/lib/cn.ts'
import { collectClipboardFiles, isNonPlaceholderClipboardFile } from '#/web/clipboard/collect-clipboard-files.ts'
import { previewPaste, processDrop } from '#/web/clipboard/process.ts'
import { resolvePastedFiles } from '#/web/clipboard/resolver.ts'
import { planTerminalPathWrite } from '#/web/clipboard/terminal-path-write.ts'
import type { PasteResolution } from '#/web/clipboard/resolver.ts'
import { useT } from '#/web/stores/i18n.ts'
import { terminalLog } from '#/web/logger.ts'
import { formatTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import {
  useTerminalFilesystemTargetSelectedDescriptor,
  useTerminalFilesystemTargetSessionDescriptor,
  useTerminalFilesystemTargetCount,
  useTerminalFilesystemTargetCreatePending,
  useTerminalSnapshot,
} from '#/web/components/terminal/terminal-session-store.ts'
import { TerminalComposer, type TerminalComposerHandle } from '#/web/components/terminal/terminal-composer.tsx'
import { terminalSessionCoordinates, type TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { TerminalProjectionHydrationPhase } from '#/web/stores/terminal-projection-hydration.ts'
import { cancelTerminalAutoFocus, fulfillTerminalPresentationFocus } from '#/web/terminal-focus.ts'
import type { TerminalInputWriter } from '#/web/components/terminal/types.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'
import { isImeOwnedKeyboardEvent, isMacNavigatorPlatform } from '#/web/components/terminal/terminal-keyboard.ts'
import {
  AttachmentOverlay,
  EmptyTerminalCta,
  PresentationFailureOverlay,
  StatusOverlay,
} from '#/web/components/terminal/terminal-session-overlays.tsx'

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
  const sessionRootRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const composerRef = useRef<TerminalComposerHandle | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const context = useTerminalSessionContext()
  const {
    clearBell,
    attach,
    detach,
    findNext,
    findPrevious,
    clearSearch,
    captureInputWriter,
    sendVirtualKey,
    openComposer,
    closeComposer,
    setComposerMode,
    setComposerDraft,
    replaceComposerDraft,
    submitText,
    takeover,
    retryPresentation,
    restart,
    focusTerminal,
  } = context
  const { workspaceId, executionRootId } = terminalSessionCoordinates(base)
  const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKey(workspaceId, executionRootId)
  const selectedDescriptor = useTerminalFilesystemTargetSelectedDescriptor(terminalFilesystemTargetKey)
  const explicitDescriptor = useTerminalFilesystemTargetSessionDescriptor({
    terminalFilesystemTargetKey,
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
  const hasSessions = useTerminalFilesystemTargetCount(terminalFilesystemTargetKey) > 0
  const createPending = useTerminalFilesystemTargetCreatePending(terminalFilesystemTargetKey)
  const terminalComposerShortcut = isMacNavigatorPlatform(globalThis.navigator?.platform ?? '')
    ? 'Meta+Shift+Enter'
    : 'Control+Shift+Enter'
  const terminalComposerLabels = {
    composer: t('terminal.composer-label'),
    open: t('terminal.composer-open'),
    close: t('terminal.composer-close'),
    inputPlaceholder: t('terminal.composer-input-placeholder'),
    more: t('terminal.composer-more'),
    uploadFiles: t('terminal.composer-upload-files'),
    showKeys: t('terminal.composer-show-keys'),
    showInput: t('terminal.composer-show-input'),
    enter: t('terminal.composer-key-enter'),
    backspace: t('terminal.composer-key-backspace'),
    tab: t('terminal.composer-key-tab'),
    arrowUp: t('terminal.composer-key-arrow-up'),
    arrowDown: t('terminal.composer-key-arrow-down'),
    arrowLeft: t('terminal.composer-key-arrow-left'),
    arrowRight: t('terminal.composer-key-arrow-right'),
    escape: t('terminal.composer-key-escape'),
    ctrlL: t('terminal.composer-key-ctrl-l'),
    ctrlC: t('terminal.composer-key-ctrl-c'),
    ctrlD: t('terminal.composer-key-ctrl-d'),
  }

  useLayoutEffect(() => {
    const host = hostRef.current
    const selectedDescriptor = descriptorRef.current
    if (!host || !selectedDescriptor || selectedDescriptor.terminalSessionId !== terminalSessionId) return
    attach(selectedDescriptor, host)
    let mounted = true
    queueMicrotask(() => {
      if (mounted) fulfillTerminalPresentationFocus(selectedDescriptor.terminalSessionId, focusTerminal)
    })
    return () => {
      mounted = false
      detach(selectedDescriptor.terminalSessionId, host)
    }
  }, [attach, detach, focusTerminal, terminalSessionId])

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
    return () => {
      if (terminalSessionId) clearSearch(terminalSessionId)
    }
  }, [clearSearch, terminalSessionId])

  const closeSearch = useCallback(() => {
    if (terminalSessionId) clearSearch(terminalSessionId)
    setSearchOpen(false)
    setSearchTerm('')
  }, [clearSearch, terminalSessionId])
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
  const handleSearchKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (isTerminalSearchShortcut(event)) {
        event.preventDefault()
        event.stopPropagation()
        cancelTerminalAutoFocus()
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
  // Controller ownership gates input affordances. The PTY is dead in
  // `error-controller`, so it is excluded even though ownership is still ours.
  const isController = sessionPhase === 'open-controller'
  const isReadonly = sessionPhase === 'open-viewer' || sessionPhase === 'error-viewer'
  const isAttaching = sessionPhase === 'opening' || sessionPhase === 'restarting'

  const hideTerminalHost = isReadonly || (hasSessions && isAttaching)
  const presentationRecovery = snapshot.presentationRecovery
  // Keep controller-owned Composer state mounted during a local presentation
  // recovery, but do not expose controls until the xterm is available again.
  const composerHidden = searchOpen || presentationRecovery !== undefined
  const showViewerOverlay = sessionPhase === 'open-viewer' && attachment?.role === 'viewer' && !presentationRecovery
  const showUnownedOverlay = sessionPhase === 'open-viewer' && attachment?.role === 'unowned' && !presentationRecovery
  const showErrorChip = sessionPhase === 'error-controller' || sessionPhase === 'error-viewer'
  const canRestart = sessionPhase === 'error-controller'
  const terminalErrorMessageKey = snapshot.message ?? DEFAULT_TERMINAL_ERROR_MESSAGE_KEY
  const readonlyBadge = t('terminal.mirror-controlled')
  // Status-chip visibility is derived here (not in a JSX branch chain)
  // so the chip's mount identity stays stable across the `!hasSessions`
  // ↔ `hasSessions` flip during a normal terminal open. Stable mount
  // prevents mount-orchestrated aria-live re-announcement; text-change
  // re-announcement is still possible when the label transitions within
  // the same node (e.g. `Loading…` → `Opening…` when `projectionPhase` flips),
  // which is the standard polite-live-region contract.
  const projectionPending = projectionPhase === 'pending'
  const projectionFailed = projectionPhase === 'failed'

  const handleKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (isTerminalComposerShortcut(event)) {
        let opened = false
        if (!terminalSessionId || !isController || presentationRecovery || isImeOwnedKeyboardEvent(event.nativeEvent)) {
          return
        }
        flushSync(() => {
          opened = openComposer(terminalSessionId)
        })
        if (!opened) return
        event.preventDefault()
        event.stopPropagation()
        cancelTerminalAutoFocus()
        if (searchOpen) closeSearch()
        composerRef.current?.focus()
        return
      }
      handleSearchKeyDownCapture(event)
    },
    [
      closeSearch,
      handleSearchKeyDownCapture,
      isController,
      presentationRecovery,
      searchOpen,
      openComposer,
      terminalSessionId,
    ],
  )
  const showPresentationFailure = !showErrorChip && !isAttaching && presentationRecovery === 'failed'
  const showProjectionRecoveryFailure =
    !showErrorChip &&
    projectionFailed &&
    ((sessionPhase === 'opening' && !hasSessions) || (!isAttaching && presentationRecovery === 'pending'))
  const showEmptyCta = sessionPhase === 'opening' && !hasSessions && projectionPhase === 'ready' && !createPending
  const showStatusOverlay =
    (isAttaching && !showEmptyCta && !(sessionPhase === 'opening' && !hasSessions && projectionFailed)) ||
    (!showErrorChip && !isAttaching && presentationRecovery === 'pending' && !projectionFailed)
  const statusOverlayLabel =
    sessionPhase === 'restarting'
      ? t('terminal.restarting')
      : sessionPhase === 'opening' && !hasSessions && projectionPending
        ? t('terminal.loading')
        : presentationRecovery === 'pending'
          ? t('terminal.restoring')
          : t('terminal.opening')
  const projectionFailureLabel = projectionErrorMessage
    ? `${t('terminal.load-failed')} (${projectionErrorMessage})`
    : t('terminal.load-failed')
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
  const prepareResolvedPaths = useCallback(
    (resolution: PasteResolution) => {
      const plan = planTerminalPathWrite(resolution.paths, {
        failedUnsafe: resolution.failedUnsafe,
        failedBackend: resolution.failedBackend,
      })
      if (plan.kind === 'none') {
        if (plan.failures.failedUnsafe > 0) toast.error(t('terminal.paste-file-unsafe'))
        if (plan.failures.failedBackend > 0) toast.error(t('terminal.paste-file-failed'))
        return null
      }
      if (plan.kind === 'too-long') {
        toast.error(t('terminal.paste-file-overflow'))
        return null
      }
      return plan
    },
    [t],
  )
  const reportResolvedPathFailures = useCallback(
    (failures: { failedUnsafe: number; failedBackend: number }) => {
      if (failures.failedUnsafe > 0) toast.error(t('terminal.paste-file-unsafe'))
      if (failures.failedBackend > 0) toast.error(t('terminal.paste-file-partial'))
    },
    [t],
  )
  const writeResolutionToPty = useCallback(
    (resolution: PasteResolution, inputWriter: TerminalInputWriter) => {
      const plan = prepareResolvedPaths(resolution)
      if (!plan) return
      if (!inputWriter(plan.data)) {
        toast.error(t('terminal.paste-file-failed'))
        return
      }
      reportResolvedPathFailures(plan.failures)
    },
    [prepareResolvedPaths, reportResolvedPathFailures, t],
  )
  const handleDroppedFiles = useCallback(
    (selectedFiles: File[]) => {
      // `isController` gate matches paste: a viewer dropping files into
      // a session it doesn't own would otherwise silently route input
      // to the controller's PTY. The `!terminalSessionId` half preserves the
      // pre-existing guard against sessions with no session.
      if (!terminalSessionId || !isController) return
      const files = selectedFiles.filter(isNonPlaceholderClipboardFile)
      if (files.length === 0) return
      // Capture the terminal session the user actually dropped into. Async
      // file resolution may finish after the user changes panes, but the
      // operation's target was fixed by the drop event.
      const inputWriter = captureInputWriter(terminalSessionId)
      if (!inputWriter) return
      void processDrop({ files }).then(
        (outcome) => {
          // `no-op` is unreachable at this call site: `handleDrop`
          // filters zero-byte files before calling `processDrop`, so
          // `processDrop` can only return `files` or `too-large`.
          // `handlePasteCapture` uses the same if-narrowing shape.
          if (outcome.kind === 'files') {
            writeResolutionToPty(outcome.resolution, inputWriter)
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
    [captureInputWriter, isController, terminalSessionId, t, writeResolutionToPty],
  )
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      setDragOver(false)
      handleDroppedFiles(Array.from(event.dataTransfer.files))
    },
    [handleDroppedFiles],
  )
  const resolveComposerFiles = useCallback(
    async (selectedFiles: File[]) => {
      if (!terminalSessionId || !isController) return null
      const files = selectedFiles.filter(isNonPlaceholderClipboardFile)
      if (files.length === 0) return null
      try {
        const outcome = await processDrop({ files })
        if (outcome.kind === 'too-large') {
          toast.error(t('terminal.paste-file-too-large'))
          return null
        }
        if (outcome.kind === 'no-op') return null
        const plan = prepareResolvedPaths(outcome.resolution)
        if (!plan) return null
        reportResolvedPathFailures(plan.failures)
        return plan.data
      } catch (err) {
        terminalLog.warn('composer file resolver failed', { err })
        toast.error(t('terminal.paste-file-failed'))
        return null
      }
    },
    [isController, prepareResolvedPaths, reportResolvedPathFailures, t, terminalSessionId],
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
      const inputWriter = captureInputWriter(terminalSessionId)
      if (!inputWriter) return
      void resolvePastedFiles(files).then(
        (resolution) => {
          writeResolutionToPty(resolution, inputWriter)
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
    [captureInputWriter, isController, terminalSessionId, t, writeResolutionToPty],
  )
  const handleComposerSend = useCallback(
    async (text: string) => {
      if (!terminalSessionId || !isController || !text) return false
      return await submitText(terminalSessionId, text)
    },
    [isController, submitText, terminalSessionId],
  )

  return (
    <div
      ref={sessionRootRef}
      className="goblin-terminal-session focus-visible:outline-none"
      tabIndex={-1}
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
      <div
        ref={hostRef}
        className={cn('goblin-terminal-session__host', hideTerminalHost && 'goblin-terminal-session__host--hidden')}
        aria-readonly={(!isController && hasSessions) || undefined}
      />
      {isController && terminalSessionId && (
        <TerminalComposer
          ref={composerRef}
          key={terminalSessionId}
          className="goblin-terminal-composer--floating"
          hidden={composerHidden}
          labels={terminalComposerLabels}
          expanded={snapshot.composer.expanded}
          mode={snapshot.composer.mode}
          draft={snapshot.composer.draft}
          historyEntries={snapshot.composer.historyEntries}
          shortcut={terminalComposerShortcut}
          onVirtualKey={(key) => sendVirtualKey(terminalSessionId, key)}
          onSendText={handleComposerSend}
          onOpen={() => openComposer(terminalSessionId)}
          onClose={() => closeComposer(terminalSessionId)}
          onModeChange={(mode) => setComposerMode(terminalSessionId, mode)}
          onDraftChange={(draft) => setComposerDraft(terminalSessionId, draft)}
          onDraftReplace={(expectedDraft, draft) => replaceComposerDraft(terminalSessionId, expectedDraft, draft)}
          onResolveFiles={resolveComposerFiles}
        />
      )}
      {showViewerOverlay && (
        <AttachmentOverlay
          badge={readonlyBadge}
          snapshot={snapshot}
          takeover={{
            label: t('terminal.takeover'),
            pendingLabel: t('terminal.taking-over'),
            terminalSessionId,
            pending: snapshot.takeoverPending,
            run: (takeoverSessionId) => {
              // A negative result is authoritative; a rejected request still
              // carries its delivery classification to this feedback boundary.
              void takeover(takeoverSessionId).then(
                (ok) => {
                  if (!ok) showTerminalTakeoverFailure(null, t)
                },
                (error: unknown) => showTerminalTakeoverFailure(error, t),
              )
            },
          }}
        />
      )}
      {showUnownedOverlay && <AttachmentOverlay badge={t('terminal.unowned')} snapshot={snapshot} />}
      {/* Stable mount — see the constants block above for the aria-live rationale. */}
      {showStatusOverlay && <StatusOverlay label={statusOverlayLabel} />}
      {showProjectionRecoveryFailure && <PresentationFailureOverlay label={projectionFailureLabel} />}
      {showPresentationFailure && (
        <PresentationFailureOverlay
          label={t('terminal.restore-failed')}
          retryLabel={t('error.try-again')}
          onRetry={() => terminalSessionId && retryPresentation(terminalSessionId)}
        />
      )}
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
      {/* A retained error binding stays visible to every attachment. Only
          its controller can restart it; the existing takeover protocol is
          intentionally unavailable once the PTY is no longer open. */}
      {showErrorChip && snapshot.message !== 'terminal.empty' && (
        <div className="goblin-terminal-session__status-overlay goblin-terminal-session__status-overlay--error">
          <span>{t(terminalErrorMessageKey)}</span>
          {terminalSessionId && canRestart && (
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

function showTerminalTakeoverFailure(error: unknown, t: (key: string) => string): void {
  if (error instanceof ClientRealtimeRequestError) {
    if (error.kind === 'app-quitting') return
    if (error.delivery === 'indeterminate') {
      toast.warning(t('terminal.takeover-delivery-uncertain'))
      return
    }
  }
  toast.error(t('action.result-error'), { description: t('terminal.takeover-failed') })
}

function isTerminalSearchShortcut(event: KeyboardEvent<HTMLDivElement>): boolean {
  if (event.altKey || event.key.toLowerCase() !== 'f') return false
  return event.metaKey || (event.ctrlKey && event.shiftKey)
}

function isTerminalComposerShortcut(event: KeyboardEvent<HTMLDivElement>): boolean {
  if (event.key !== 'Enter' || !event.shiftKey || event.altKey) return false
  const isMac = isMacNavigatorPlatform(globalThis.navigator?.platform ?? '')
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}
