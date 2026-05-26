import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'
import { Button } from '#/renderer/components/ui/button.tsx'
import { cn } from '#/renderer/lib/cn.ts'
import { setTerminalFocused } from '#/renderer/terminal-focus.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { terminalSessionGroupKey } from '#/renderer/components/terminal/terminal-session-utils.ts'
import { useTerminalSessionContext } from '#/renderer/components/terminal/terminal-session-context.ts'
import { TerminalSwitcher } from '#/renderer/components/terminal/TerminalSwitcher.tsx'
import type { TerminalSessionBase } from '#/renderer/components/terminal/types.ts'

interface TerminalSlotProps {
  repoRoot: string
  branch: string
  worktreePath: string
}

export function TerminalSlot({ repoRoot, branch, worktreePath }: TerminalSlotProps) {
  const t = useT()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const initializedGroupRef = useRef<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const context = useTerminalSessionContext()
  const {
    ensureDefault,
    createTerminal,
    activeDescriptor,
    sessionSummaries,
    setActive,
    closeTerminalAndDismissDetailIfLast,
    attach,
    detach,
    isTerminalFocusTarget,
    snapshot: getSnapshot,
    version,
    findNext,
    findPrevious,
    clearSearch,
  } = context
  const groupKey = terminalSessionGroupKey(repoRoot, worktreePath)
  const base = useMemo<TerminalSessionBase>(
    () => ({ repoRoot, branch, worktreePath }),
    [branch, repoRoot, worktreePath],
  )
  const descriptor = useMemo(() => activeDescriptor(groupKey), [activeDescriptor, groupKey, version])
  const key = descriptor?.key ?? null
  const summaries = useMemo(() => sessionSummaries(groupKey), [groupKey, sessionSummaries, version])
  const snapshot = useMemo(
    () => (key ? getSnapshot(key) : { phase: 'error' as const, message: 'terminal.empty', processName: 'terminal' }),
    [getSnapshot, key, version],
  )

  useLayoutEffect(() => {
    if (initializedGroupRef.current === groupKey) return
    initializedGroupRef.current = groupKey
    ensureDefault(base)
  }, [base, ensureDefault, groupKey])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || !descriptor) return
    attach(descriptor, host)
    return () => detach(descriptor.key, host)
  }, [attach, descriptor, detach])

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

  const newTerminal = useCallback(() => createTerminal(base), [base, createTerminal])
  const closeTerminalKey = useCallback(
    (terminalKey: string) => {
      closeTerminalAndDismissDetailIfLast(terminalKey, base)
    },
    [base, closeTerminalAndDismissDetailIfLast],
  )
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

  const progress = snapshot.progress
  const progressVariant =
    progress?.state === 2 ? 'error' : progress?.state === 4 ? 'warning' : progress?.state === 3 ? 'indeterminate' : ''

  return (
    <div
      className="goblin-terminal-slot"
      tabIndex={-1}
      onFocusCapture={handleFocus}
      onBlurCapture={handleBlur}
      onKeyDownCapture={handleKeyDownCapture}
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
      <div ref={hostRef} className="goblin-terminal-slot__host" />
      <TerminalSwitcher
        groupKey={groupKey}
        sessions={summaries}
        offsetForSearch={searchOpen}
        onNew={newTerminal}
        onSelect={setActive}
        onClose={closeTerminalKey}
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
      {snapshot.phase === 'opening' && (
        <div className="goblin-terminal-slot__status-overlay">
          <span>{t('terminal.opening')}</span>
        </div>
      )}
      {snapshot.phase === 'error' && snapshot.message !== 'terminal.empty' && (
        <div className="goblin-terminal-slot__status-overlay">
          <span>{t(snapshot.message ?? 'error.unknown')}</span>
        </div>
      )}
    </div>
  )
}

function isTerminalSearchShortcut(event: KeyboardEvent<HTMLDivElement>): boolean {
  if (event.altKey || event.key.toLowerCase() !== 'f') return false
  return event.metaKey || (event.ctrlKey && event.shiftKey)
}
