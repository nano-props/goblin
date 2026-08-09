import { computed, defineComponent, nextTick, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { toast } from 'vue-sonner'
import { PasteFileLimitError } from '#/shared/clipboard-paste.ts'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import { formatTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import { terminalSessionCoordinates } from '#/shared/terminal-types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { collectClipboardFiles, isNonPlaceholderClipboardFile } from '#/web/clipboard/collect-clipboard-files.ts'
import { copyToClipboard } from '#/web/clipboard/clipboard-copy.ts'
import { previewPaste, processDrop } from '#/web/clipboard/process.ts'
import { resolvePastedFiles } from '#/web/clipboard/resolver.ts'
import type { PasteResolution } from '#/web/clipboard/resolver.ts'
import { planTerminalPathWrite } from '#/web/clipboard/terminal-path-write.ts'
import { TerminalComposer } from '#/web/components/terminal/terminal-composer.tsx'
import type { TerminalComposerHandle, TerminalComposerLabels } from '#/web/components/terminal/terminal-composer.tsx'
import { isImeOwnedKeyboardEvent, isMacNavigatorPlatform } from '#/web/components/terminal/terminal-keyboard.ts'
import {
  AttachmentOverlay,
  EmptyTerminalCta,
  PresentationFailureOverlay,
  StatusOverlay,
} from '#/web/components/terminal/terminal-session-overlays.tsx'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import {
  useTerminalFilesystemTargetCount,
  useTerminalFilesystemTargetCreatePending,
  useTerminalFilesystemTargetSelectedDescriptor,
  useTerminalFilesystemTargetSessionDescriptor,
  useTerminalSnapshot,
} from '#/web/components/terminal/terminal-session-store.ts'
import type { TerminalInputWriter } from '#/web/components/terminal/types.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { cn } from '#/web/lib/cn.ts'
import { terminalLog } from '#/web/logger.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'
import type { TerminalProjectionHydrationPhase } from '#/web/stores/terminal-projection-hydration.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { cancelTerminalAutoFocus, fulfillTerminalPresentationFocus } from '#/web/terminal-focus.ts'

const DEFAULT_TERMINAL_ERROR_MESSAGE_KEY = 'error.unknown'

const TERMINAL_PASTE_FILE_ERROR_KEYS = {
  file: 'terminal.paste-file-too-large',
  batch: 'terminal.paste-file-batch-too-large',
  count: 'terminal.paste-file-too-many',
} as const satisfies Record<PasteFileLimitError['kind'], string>

function terminalPasteFileErrorKey(error: unknown): string {
  if (!(error instanceof PasteFileLimitError)) return 'terminal.paste-file-failed'
  return TERMINAL_PASTE_FILE_ERROR_KEYS[error.kind]
}

interface TerminalSessionViewProps {
  base: TerminalSessionBase
  selectedTerminalSessionId?: string | null
  projectionPhase?: TerminalProjectionHydrationPhase
  projectionErrorMessage?: string
  createTerminalForSlot: (base: TerminalSessionBase) => Promise<unknown>
}

type SessionPhase = 'opening' | 'restarting' | 'open-controller' | 'open-viewer' | 'error-controller' | 'error-viewer'

type TerminalFileInputAdmission = 'available' | 'remote-unsupported' | 'inactive'

export const TerminalSessionView = defineComponent<TerminalSessionViewProps>({
  name: 'TerminalSessionView',
  props: ['base', 'selectedTerminalSessionId', 'projectionPhase', 'projectionErrorMessage', 'createTerminalForSlot'],

  setup(props) {
    const t = useT()
    const sessionRoot = ref<HTMLDivElement | null>(null)
    const host = ref<HTMLDivElement | null>(null)
    const searchInput = ref<HTMLInputElement | null>(null)
    const composer = ref<TerminalComposerHandle | null>(null)
    const searchOpen = ref(false)
    const searchTerm = ref('')
    const dragOver = ref(false)
    const pendingFileResolutions = shallowRef<ReadonlyMap<string, number>>(new Map())
    const context = useTerminalSessionContext()
    const coordinates = computed(() => terminalSessionCoordinates(props.base))
    const supportsTerminalFilePaths = computed(() => !isRemoteWorkspaceId(coordinates.value.workspaceId))
    const terminalFilesystemTargetKey = computed(() =>
      formatTerminalFilesystemTargetKey(coordinates.value.workspaceId, coordinates.value.executionRootId),
    )
    const selectedDescriptor = useTerminalFilesystemTargetSelectedDescriptor(terminalFilesystemTargetKey)
    const explicitDescriptor = useTerminalFilesystemTargetSessionDescriptor({
      terminalFilesystemTargetKey,
      terminalSessionId: () => props.selectedTerminalSessionId ?? null,
      base: () => props.base,
    })
    const descriptor = computed(() =>
      props.selectedTerminalSessionId === undefined ? selectedDescriptor.value : explicitDescriptor.value,
    )
    const terminalSessionId = computed(() =>
      props.selectedTerminalSessionId === undefined
        ? (selectedDescriptor.value?.terminalSessionId ?? null)
        : props.selectedTerminalSessionId,
    )
    const snapshot = useTerminalSnapshot(terminalSessionId)
    const sessionCount = useTerminalFilesystemTargetCount(terminalFilesystemTargetKey)
    const createPending = useTerminalFilesystemTargetCreatePending(terminalFilesystemTargetKey)
    const sessionPhase = computed<SessionPhase>(() => {
      if (sessionCount.value === 0 || snapshot.value.phase === 'opening') return 'opening'
      if (snapshot.value.phase === 'restarting') return 'restarting'
      if (snapshot.value.phase === 'error') {
        return snapshot.value.attachment?.role === 'controller' ? 'error-controller' : 'error-viewer'
      }
      return snapshot.value.attachment?.role === 'controller' ? 'open-controller' : 'open-viewer'
    })
    const isController = computed(() => sessionPhase.value === 'open-controller')
    const terminalFileInputSessionId = computed(() => (isController.value ? terminalSessionId.value : null))
    const terminalFileInputAdmission = computed<TerminalFileInputAdmission>(() => {
      if (!terminalFileInputSessionId.value) return 'inactive'
      return supportsTerminalFilePaths.value ? 'available' : 'remote-unsupported'
    })
    const terminalComposerShortcut = isMacNavigatorPlatform(globalThis.navigator?.platform ?? '')
      ? 'Meta+Shift+Enter'
      : 'Control+Shift+Enter'

    // Bell presentation and search decorations belong to the session, not to
    // the host element used to display it.
    watch(
      terminalSessionId,
      (sessionId, _previous, onCleanup) => {
        if (!sessionId) return
        if (typeof document !== 'undefined' && document.hasFocus()) context.clearBell(sessionId)
        const clearFocusedBell = () => context.clearBell(sessionId)
        window.addEventListener('focus', clearFocusedBell)
        onCleanup(() => {
          window.removeEventListener('focus', clearFocusedBell)
          context.clearSearch(sessionId)
        })
      },
      { immediate: true },
    )

    // The xterm attachment belongs to the concrete session/host pair. The
    // host ref becoming available after mount must not restart session-owned
    // listeners or clear that session's search decorations.
    watch(
      [terminalSessionId, host],
      ([sessionId, hostElement], _previous, onCleanup) => {
        if (!sessionId || !hostElement) return
        const selected = descriptor.value
        if (!selected || selected.terminalSessionId !== sessionId) return

        let attached = true
        context.attach(selected, hostElement)
        queueMicrotask(() => {
          if (attached) fulfillTerminalPresentationFocus(sessionId, context.focusTerminal)
        })
        onCleanup(() => {
          attached = false
          context.detach(sessionId, hostElement)
        })
      },
      { flush: 'post' },
    )

    // A file-drag highlight is gesture-local and must not revive if authority
    // leaves and later returns.
    watch(terminalFileInputAdmission, (admission) => {
      if (admission !== 'available') dragOver.value = false
    })

    function terminalComposerLabels(): TerminalComposerLabels {
      return {
        composer: t('terminal.composer-label'),
        open: t('terminal.composer-open'),
        close: t('terminal.composer-close'),
        inputPlaceholder: t('terminal.composer-input-placeholder'),
        more: t('terminal.composer-more'),
        uploadFiles: t('terminal.composer-upload-files'),
        copyContent: t('terminal.composer-copy-content'),
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
    }

    async function copyContent(): Promise<void> {
      const sessionId = terminalSessionId.value
      if (!sessionId) return
      try {
        const text = context.readCopyText(sessionId)
        if (!text) {
          toast.error(t('terminal.composer-copy-content-empty'))
          return
        }
        await copyToClipboard(text)
        toast.success(t('branch-status.copied'))
      } catch (error) {
        toast.error(t('action.result-error'), {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    }

    function closeSearch(): void {
      const sessionId = terminalSessionId.value
      if (sessionId) context.clearSearch(sessionId)
      searchOpen.value = false
      searchTerm.value = ''
    }

    function openSearch(): void {
      cancelTerminalAutoFocus()
      searchOpen.value = true
      void nextTick(() => searchInput.value?.focus({ preventScroll: true }))
    }

    function searchNext(term = searchTerm.value, incremental = false): void {
      const sessionId = terminalSessionId.value
      if (sessionId) context.findNext(sessionId, term, incremental)
    }

    function searchPrevious(): void {
      const sessionId = terminalSessionId.value
      if (sessionId) context.findPrevious(sessionId, searchTerm.value)
    }

    function handleSearchShortcut(event: KeyboardEvent): void {
      if (isTerminalSearchShortcut(event)) {
        event.preventDefault()
        event.stopPropagation()
        openSearch()
      } else if (searchOpen.value && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeSearch()
      }
    }

    function handleSearchKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Enter') return
      event.preventDefault()
      if (event.shiftKey) searchPrevious()
      else searchNext()
    }

    function trackFileResolution<T>(sessionId: string, resolution: Promise<T>): Promise<T> {
      const next = new Map(pendingFileResolutions.value)
      next.set(sessionId, (next.get(sessionId) ?? 0) + 1)
      pendingFileResolutions.value = next
      return resolution.finally(() => {
        const current = new Map(pendingFileResolutions.value)
        const remaining = (current.get(sessionId) ?? 1) - 1
        if (remaining === 0) current.delete(sessionId)
        else current.set(sessionId, remaining)
        pendingFileResolutions.value = current
      })
    }

    function handleKeyDownCapture(event: KeyboardEvent): void {
      if (isTerminalComposerShortcut(event)) {
        const sessionId = terminalSessionId.value
        if (
          !sessionId ||
          !isController.value ||
          snapshot.value.presentationRecovery ||
          isImeOwnedKeyboardEvent(event)
        ) {
          return
        }
        if (!context.openComposer(sessionId)) return
        event.preventDefault()
        event.stopPropagation()
        cancelTerminalAutoFocus()
        if (searchOpen.value) closeSearch()
        void nextTick(() => composer.value?.focus())
        return
      }
      handleSearchShortcut(event)
    }

    function handleDragEnter(event: DragEvent): void {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = terminalFileInputAdmission.value === 'available' ? 'copy' : 'none'
      dragOver.value = terminalFileInputAdmission.value === 'available'
    }

    function handleDragOver(event: DragEvent): void {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = terminalFileInputAdmission.value === 'available' ? 'copy' : 'none'
    }

    function handleDragLeave(event: DragEvent): void {
      if (!event.dataTransfer?.types.includes('Files')) return
      const relatedTarget = event.relatedTarget
      if (
        !(relatedTarget instanceof Node) ||
        !(event.currentTarget instanceof Node) ||
        !event.currentTarget.contains(relatedTarget)
      ) {
        dragOver.value = false
      }
    }

    function prepareResolvedPaths(resolution: PasteResolution) {
      const plan = planTerminalPathWrite(resolution.paths)
      if (plan.kind === 'none' || plan.kind === 'invalid') {
        toast.error(t('terminal.paste-file-failed'))
        return null
      }
      if (plan.kind === 'unsafe') {
        toast.error(t('terminal.paste-file-unsafe'))
        return null
      }
      if (plan.kind === 'too-long') {
        toast.error(t('terminal.paste-file-overflow'))
        return null
      }
      return plan
    }

    function writeResolutionToPty(resolution: PasteResolution, inputWriter: TerminalInputWriter): void {
      const plan = prepareResolvedPaths(resolution)
      if (plan && !inputWriter(plan.data)) toast.warning(t('terminal.write-not-sent'))
    }

    function handleDroppedFiles(selectedFiles: File[]): void {
      const sessionId = terminalFileInputSessionId.value
      if (!sessionId) return
      const files = selectedFiles.filter(isNonPlaceholderClipboardFile)
      if (files.length === 0) return
      if (terminalFileInputAdmission.value === 'remote-unsupported') {
        toast.error(t('terminal.paste-file-remote-unsupported'))
        return
      }
      const inputWriter = context.captureInputWriter(sessionId)
      if (!inputWriter) {
        toast.warning(t('terminal.write-not-sent'))
        return
      }
      void trackFileResolution(sessionId, processDrop({ files })).then(
        (outcome) => {
          if (outcome.kind === 'files') writeResolutionToPty(outcome.resolution, inputWriter)
        },
        (error) => {
          terminalLog.warn('drop resolver failed', { err: error })
          const errorKey = terminalPasteFileErrorKey(error)
          toast.error(t(errorKey))
        },
      )
    }

    function handleDrop(event: DragEvent): void {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      dragOver.value = false
      handleDroppedFiles(Array.from(event.dataTransfer.files))
    }

    async function resolveComposerFiles(selectedFiles: File[]): Promise<string | null> {
      const sessionId = terminalFileInputSessionId.value
      if (!sessionId) return null
      const files = selectedFiles.filter(isNonPlaceholderClipboardFile)
      if (files.length === 0) return null
      if (terminalFileInputAdmission.value === 'remote-unsupported') {
        toast.error(t('terminal.paste-file-remote-unsupported'))
        return null
      }
      try {
        const outcome = await trackFileResolution(sessionId, processDrop({ files }))
        if (outcome.kind === 'no-op') return null
        return prepareResolvedPaths(outcome.resolution)?.data ?? null
      } catch (error) {
        terminalLog.warn('composer file resolver failed', { err: error })
        const errorKey = terminalPasteFileErrorKey(error)
        toast.error(t(errorKey))
        return null
      }
    }

    function handlePasteCapture(event: ClipboardEvent): void {
      const sessionId = terminalFileInputSessionId.value
      if (!sessionId || !event.clipboardData) return
      const files = collectClipboardFiles(event.clipboardData)
      const text = event.clipboardData.getData('text/plain')
      const preview = previewPaste({ text, files })
      if (preview.kind === 'text' || preview.kind === 'no-op') return

      event.preventDefault()
      event.stopPropagation()
      if (terminalFileInputAdmission.value === 'remote-unsupported') {
        toast.error(t('terminal.paste-file-remote-unsupported'))
        return
      }
      const inputWriter = context.captureInputWriter(sessionId)
      if (!inputWriter) {
        toast.warning(t('terminal.write-not-sent'))
        return
      }
      void trackFileResolution(sessionId, resolvePastedFiles(files)).then(
        (resolution) => writeResolutionToPty(resolution, inputWriter),
        (error) => {
          terminalLog.warn('paste resolver failed', { err: error })
          const errorKey = terminalPasteFileErrorKey(error)
          toast.error(t(errorKey))
        },
      )
    }

    async function handleComposerSend(text: string): Promise<boolean> {
      const sessionId = terminalSessionId.value
      if (!sessionId || !isController.value || !text) return false
      return context.submitText(sessionId, text)
    }

    let captureRoot: HTMLDivElement | null = null
    onMounted(() => {
      captureRoot = sessionRoot.value
      captureRoot?.addEventListener('keydown', handleKeyDownCapture, true)
      captureRoot?.addEventListener('paste', handlePasteCapture, true)
    })
    onScopeDispose(() => {
      captureRoot?.removeEventListener('keydown', handleKeyDownCapture, true)
      captureRoot?.removeEventListener('paste', handlePasteCapture, true)
    })

    return () => {
      const currentSnapshot = snapshot.value
      const currentSessionId = terminalSessionId.value
      const hasSessions = sessionCount.value > 0
      const currentSessionPhase = sessionPhase.value
      const attachment = currentSnapshot.attachment
      const controller = currentSessionPhase === 'open-controller'
      const readonly = currentSessionPhase === 'open-viewer' || currentSessionPhase === 'error-viewer'
      const attaching = currentSessionPhase === 'opening' || currentSessionPhase === 'restarting'
      const admission = terminalFileInputAdmission.value
      const fileResolutionPending = currentSessionId
        ? (pendingFileResolutions.value.get(currentSessionId) ?? 0) > 0
        : false
      const progress = currentSnapshot.progress ?? (fileResolutionPending ? { state: 3 as const, value: 0 } : null)
      const progressLabelKey = currentSnapshot.progress ? 'terminal.progress' : 'terminal.file-resolution-progress'
      let progressVariant = ''
      if (progress?.state === 2) progressVariant = 'error'
      else if (progress?.state === 4) progressVariant = 'warning'
      else if (progress?.state === 3) progressVariant = 'indeterminate'

      let resultLabel = ''
      if (currentSnapshot.search && searchTerm.value) {
        if (currentSnapshot.search.resultCount === 0) resultLabel = t('terminal.search-no-results')
        else if (currentSnapshot.search.resultIndex < 0) resultLabel = String(currentSnapshot.search.resultCount)
        else resultLabel = `${currentSnapshot.search.resultIndex + 1}/${currentSnapshot.search.resultCount}`
      }

      const presentationRecovery = currentSnapshot.presentationRecovery
      const hideTerminalHost = readonly || (hasSessions && attaching)
      const composerHidden = searchOpen.value || presentationRecovery !== undefined
      const showViewerOverlay =
        currentSessionPhase === 'open-viewer' && attachment?.role === 'viewer' && !presentationRecovery
      const showUnownedOverlay =
        currentSessionPhase === 'open-viewer' && attachment?.role === 'unowned' && !presentationRecovery
      const showErrorChip = currentSessionPhase === 'error-controller' || currentSessionPhase === 'error-viewer'
      const canRestart = currentSessionPhase === 'error-controller'
      const terminalErrorMessageKey = currentSnapshot.message ?? DEFAULT_TERMINAL_ERROR_MESSAGE_KEY
      const projectionPhase = props.projectionPhase ?? 'ready'
      const projectionPending = projectionPhase === 'pending'
      const projectionFailed = projectionPhase === 'failed'
      const showPresentationFailure = !showErrorChip && !attaching && presentationRecovery === 'failed'
      const showProjectionRecoveryFailure =
        !showErrorChip &&
        projectionFailed &&
        ((currentSessionPhase === 'opening' && !hasSessions) || (!attaching && presentationRecovery === 'pending'))
      const showEmptyCta =
        currentSessionPhase === 'opening' && !hasSessions && projectionPhase === 'ready' && !createPending.value
      const showStatusOverlay =
        (attaching && !showEmptyCta && !(currentSessionPhase === 'opening' && !hasSessions && projectionFailed)) ||
        (!showErrorChip && !attaching && presentationRecovery === 'pending' && !projectionFailed)
      let statusOverlayLabel = t('terminal.opening')
      if (currentSessionPhase === 'restarting') statusOverlayLabel = t('terminal.restarting')
      else if (currentSessionPhase === 'opening' && !hasSessions && projectionPending) {
        statusOverlayLabel = t('terminal.loading')
      } else if (presentationRecovery === 'pending') {
        statusOverlayLabel = t('terminal.restoring')
      }
      const projectionFailureLabel = props.projectionErrorMessage
        ? `${t('terminal.load-failed')} (${props.projectionErrorMessage})`
        : t('terminal.load-failed')

      return (
        <div
          ref={sessionRoot}
          class="goblin-terminal-session focus-visible:outline-none"
          tabindex={-1}
          onDragenter={handleDragEnter}
          onDragover={handleDragOver}
          onDragleave={handleDragLeave}
          onDrop={handleDrop}
        >
          {progress ? (
            <div
              class={cn('goblin-terminal-progress', progressVariant && `goblin-terminal-progress--${progressVariant}`)}
              role="progressbar"
              aria-label={t(progressLabelKey)}
              aria-valuenow={progress.state === 3 ? undefined : progress.value}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-busy={progress.state === 3 ? true : undefined}
            >
              {progress.state !== 3 ? (
                <div class="goblin-terminal-progress__bar" style={{ width: `${progress.value}%` }} />
              ) : null}
            </div>
          ) : null}
          {searchOpen.value ? (
            <div class="goblin-terminal-session__search">
              <input
                ref={searchInput}
                class="goblin-terminal-session__search-input"
                value={searchTerm.value}
                aria-label={t('terminal.search-placeholder')}
                placeholder={t('terminal.search-placeholder')}
                onInput={(event) => {
                  if (!(event.currentTarget instanceof HTMLInputElement)) return
                  searchTerm.value = event.currentTarget.value
                  searchNext(searchTerm.value, true)
                }}
                onKeydown={handleSearchKeyDown}
              />
              <span class="goblin-terminal-session__search-result" role="status" aria-live="polite" aria-atomic="true">
                {resultLabel}
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={searchPrevious} disabled={!searchTerm.value}>
                {t('terminal.search-previous')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => searchNext()} disabled={!searchTerm.value}>
                {t('terminal.search-next')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={closeSearch}>
                {t('terminal.search-close')}
              </Button>
            </div>
          ) : null}
          <div
            ref={host}
            class={cn('goblin-terminal-session__host', hideTerminalHost && 'goblin-terminal-session__host--hidden')}
            aria-readonly={(!controller && hasSessions) || undefined}
          />
          {controller && currentSessionId ? (
            <TerminalComposer
              ref={composer}
              key={currentSessionId}
              class="goblin-terminal-composer--floating"
              hidden={composerHidden}
              labels={terminalComposerLabels()}
              expanded={currentSnapshot.composer.expanded}
              mode={currentSnapshot.composer.mode}
              draft={currentSnapshot.composer.draft}
              historyEntries={currentSnapshot.composer.historyEntries}
              shortcut={terminalComposerShortcut}
              canUploadFiles={admission === 'available'}
              onVirtualKey={(key) => context.sendVirtualKey(currentSessionId, key)}
              onCopyContent={copyContent}
              onSendText={handleComposerSend}
              onOpen={() => context.openComposer(currentSessionId)}
              onClose={() => context.closeComposer(currentSessionId)}
              onModeChange={(mode) => context.setComposerMode(currentSessionId, mode)}
              onDraftChange={(draft) => context.setComposerDraft(currentSessionId, draft)}
              onDraftReplace={(expectedDraft, draft) =>
                context.replaceComposerDraft(currentSessionId, expectedDraft, draft)
              }
              onResolveFiles={resolveComposerFiles}
              onFileInsertionRejected={() => toast.warning(t('terminal.composer-file-insertion-rejected'))}
            />
          ) : null}
          {showViewerOverlay ? (
            <AttachmentOverlay
              badge={t('terminal.mirror-controlled')}
              snapshot={currentSnapshot}
              takeover={{
                label: t('terminal.takeover'),
                pendingLabel: t('terminal.taking-over'),
                terminalSessionId: currentSessionId,
                pending: currentSnapshot.takeoverPending,
                run: (takeoverSessionId) => {
                  void context.takeover(takeoverSessionId).then(
                    (ok) => {
                      if (!ok) showTerminalTakeoverFailure(null, t)
                    },
                    (error: unknown) => showTerminalTakeoverFailure(error, t),
                  )
                },
              }}
            />
          ) : null}
          {showUnownedOverlay ? <AttachmentOverlay badge={t('terminal.unowned')} snapshot={currentSnapshot} /> : null}
          {showStatusOverlay ? <StatusOverlay label={statusOverlayLabel} /> : null}
          {showProjectionRecoveryFailure ? <PresentationFailureOverlay label={projectionFailureLabel} /> : null}
          {showPresentationFailure ? (
            <PresentationFailureOverlay
              label={t('terminal.restore-failed')}
              retryLabel={t('error.try-again')}
              onRetry={() => {
                if (currentSessionId) context.retryPresentation(currentSessionId)
              }}
            />
          ) : null}
          {showEmptyCta ? (
            <EmptyTerminalCta
              onCreate={async () => {
                await props.createTerminalForSlot(props.base)
              }}
              emptyLabel={t('terminal.empty')}
              newTerminalLabel={t('terminal.new')}
            />
          ) : null}
          {showErrorChip && currentSnapshot.message !== 'terminal.empty' ? (
            <div class="goblin-terminal-session__status-overlay goblin-terminal-session__status-overlay--error">
              <span>{t(terminalErrorMessageKey)}</span>
              {currentSessionId && canRestart ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => context.restart(currentSessionId)}>
                  {t('terminal.restart')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {dragOver.value && admission === 'available' ? (
            <div class="goblin-terminal-session__drop-overlay">
              <span>{t('terminal.drop-hint')}</span>
            </div>
          ) : null}
        </div>
      )
    }
  },
})

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

function isTerminalSearchShortcut(event: KeyboardEvent): boolean {
  if (event.altKey || event.key.toLowerCase() !== 'f') return false
  return event.metaKey || (event.ctrlKey && event.shiftKey)
}

function isTerminalComposerShortcut(event: KeyboardEvent): boolean {
  if (event.key !== 'Enter' || !event.shiftKey || event.altKey) return false
  const isMac = isMacNavigatorPlatform(globalThis.navigator?.platform ?? '')
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}
