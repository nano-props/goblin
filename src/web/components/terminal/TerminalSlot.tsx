import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'
import { TerminalSquare } from 'lucide-react'
import { EmptyState } from '#/web/components/Layout.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { cn } from '#/web/lib/cn.ts'
import { setTerminalFocused } from '#/web/terminal-focus.ts'
import { pathForDroppedFile } from '#/web/app-shell-client.ts'
import { useT } from '#/web/stores/i18n.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-utils.ts'
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
    scrollLines,
    isTerminalFocusTarget,
    findNext,
    findPrevious,
    clearSearch,
    writeInput,
    takeover,
    restart,
  } = context
  const terminalWorktreeKey = worktreeTerminalKey(repoRoot, worktreePath)
  const descriptor = useWorktreeTerminalSelectedDescriptor(terminalWorktreeKey)
  const key = descriptor?.key ?? null
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
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      setDragOver(false)
      if (!key) return
      const paths = Array.from(event.dataTransfer.files)
        .map((file) => pathForDroppedFile(file))
        .filter((path) => path.length > 0)
      if (paths.length === 0) return
      const escaped = paths.map(shellEscapePath).join(' ')
      writeInput(key, escaped)
    },
    [key, writeInput],
  )

  const progress = snapshot.progress
  const attachment = snapshot.attachment
  const isController = hasSessions && snapshot.phase === 'open' && attachment?.role === 'controller'
  const isReadonly = hasSessions && snapshot.phase === 'open' && (attachment?.role === 'viewer' || attachment?.role === 'unowned')
  const readonlyBadge = attachment?.role === 'viewer' ? t('terminal.mirror-controlled') : t('terminal.unowned')
  const progressVariant =
    progress?.state === 2 ? 'error' : progress?.state === 4 ? 'warning' : progress?.state === 3 ? 'indeterminate' : ''

  return (
    <div
      className="goblin-terminal-slot focus-visible:outline-none"
      tabIndex={-1}
      onFocusCapture={handleFocus}
      onBlurCapture={handleBlur}
      onKeyDownCapture={handleKeyDownCapture}
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
      >
        {!hasSessions && (
          <div className="goblin-terminal-slot__empty">
            <EmptyState
              icon={<TerminalSquare size={18} />}
              title={t('terminal.empty-title')}
              body={t('terminal.empty-hint')}
            />
          </div>
        )}
      </div>
      <div className="goblin-terminal-float-group">
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
            onInput={(data) => writeInput(key, data)}
            onScrollLines={(amount) => scrollLines(key, amount)}
          />
        )}
      </div>
      {isReadonly && (
        <ViewerOverlay
          badge={readonlyBadge}
          takeoverLabel={t('terminal.takeover')}
          snapshot={snapshot}
          takeoverKey={key}
          onTakeover={takeover}
          takeoverPending={snapshot.takeoverPending}
        />
      )}
      {hasSessions && snapshot.phase === 'opening' && (
        <div className="goblin-terminal-slot__status-overlay">
          <span>{t('terminal.opening')}</span>
        </div>
      )}
      {hasSessions && snapshot.phase === 'error' && snapshot.message !== 'terminal.empty' && (
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
  onTakeover: (key: string) => void
  takeoverPending?: boolean
}

function ViewerOverlay({ badge, takeoverLabel, snapshot, takeoverKey, onTakeover, takeoverPending }: ViewerOverlayProps) {
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
        {snapshot.outputSummary && (
          <pre className="goblin-terminal-slot__viewer-output">{snapshot.outputSummary}</pre>
        )}
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
