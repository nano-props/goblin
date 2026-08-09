// Read-only file tree view for a filesystem-scoped Workspace Pane target.

import { FolderTree, RefreshCw } from '@lucide/vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { computed, defineComponent, ref, watch } from 'vue'
import type { FunctionalComponent } from 'vue'
import type { WorkspaceFilesystemNode } from '#/shared/api-types.ts'
import { EmptyState } from '#/web/components/Layout.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { focusRingInset } from '#/web/components/ui/focus.ts'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { FiletreeTreeRow } from '#/web/components/workspace-pane/FiletreeTreeRow.tsx'
import { buildFiletreeCollection } from '#/web/components/workspace-pane/filetree-collection.ts'
import {
  FILETREE_ROW_HEIGHT,
  findTypeaheadRowIndex,
  firstFiletreeKey,
  focusFiletreeRowAtIndex,
  topVisibleFiletreeRowIndex,
} from '#/web/components/workspace-pane/filetree-navigation.ts'
import { useRestoreTopVisibleRowIndex } from '#/web/hooks/useRestoreTopVisibleRowIndex.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import type { LazyWorkspaceFilesystemTreeAggregate } from '#/web/workspace-filesystem-lazy-state.ts'

const EMPTY_KEY_SET: ReadonlySet<string> = new Set()

export interface FiletreeViewProps {
  readonly tree: LazyWorkspaceFilesystemTreeAggregate | null
  readonly isInitialLoading: boolean
  readonly isReading: boolean
  readonly loadingKeys?: ReadonlySet<string>
  readonly openingFileKeys?: ReadonlySet<string>
  readonly error: string | null
  readonly onSelect?: (node: WorkspaceFilesystemNode) => void
  readonly onActivate?: (node: WorkspaceFilesystemNode) => void
  readonly onOpenFile?: (node: WorkspaceFilesystemNode) => void
  readonly onDownloadFile?: (node: WorkspaceFilesystemNode) => void
  readonly onRequestTrashFile?: (node: WorkspaceFilesystemNode) => void
  readonly selectedKeys: ReadonlySet<string>
  readonly expandedKeys: ReadonlySet<string>
  readonly onSelectedKeysChange: (keys: Set<string>) => void
  readonly onDirectoryRowToggle: (key: string, expanded: boolean) => void
  readonly onPruneKeys: (validKeys: ReadonlySet<string>) => void
  readonly onRetry?: () => void
  readonly initialTopVisibleRowIndex: number
  readonly scrollRestoreKey: string
  readonly scrollRestoreReady: boolean
  readonly onTopVisibleRowIndexChange: (topVisibleRowIndex: number) => void
}

const FILE_TREE_I18N_KEYS = {
  ariaLabel: 'filetree.aria-label',
  empty: 'filetree.empty',
  truncated: 'filetree.truncated',
  error: 'filetree.error',
  stale: 'filetree.stale-title',
} as const satisfies Record<string, string>

export const FiletreeView = defineComponent<FiletreeViewProps>({
  name: 'FiletreeView',
  props: [
    'tree',
    'isInitialLoading',
    'isReading',
    'loadingKeys',
    'openingFileKeys',
    'error',
    'onSelect',
    'onActivate',
    'onOpenFile',
    'onDownloadFile',
    'onRequestTrashFile',
    'selectedKeys',
    'expandedKeys',
    'onSelectedKeysChange',
    'onDirectoryRowToggle',
    'onPruneKeys',
    'onRetry',
    'initialTopVisibleRowIndex',
    'scrollRestoreKey',
    'scrollRestoreReady',
    'onTopVisibleRowIndexChange',
  ],

  setup(props) {
    const t = useT()
    const collection = computed(() => buildFiletreeCollection(props.tree, props.expandedKeys))
    const scrollViewportRef = ref<HTMLDivElement | null>(null)
    const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>(
      computed(() => ({
        count: collection.value.rows.length,
        getScrollElement: () => scrollViewportRef.value,
        estimateSize: () => FILETREE_ROW_HEIGHT,
        overscan: 12,
        getItemKey: (index: number) => collection.value.rows[index]?.id ?? index,
        initialRect: { width: 800, height: 100_000 },
      })),
    )

    // Reconcile persisted selection/expansion against the complete current
    // server projection whenever the tree changes.
    watch(
      [() => props.tree, collection],
      ([tree, currentCollection]) => {
        if (tree) props.onPruneKeys(new Set(currentCollection.byId.keys()))
      },
      { immediate: true },
    )

    useRestoreTopVisibleRowIndex({
      restoreKey: () => props.scrollRestoreKey,
      topVisibleRowIndex: () => props.initialTopVisibleRowIndex,
      enabled: () => props.tree !== null,
      ready: () => props.scrollRestoreReady,
      rowCount: () => collection.value.rows.length,
      scrollElement: scrollViewportRef,
      virtualizer: () => rowVirtualizer.value,
    })

    function selectNode(node: WorkspaceFilesystemNode): void {
      props.onSelectedKeysChange(new Set([node.id]))
      props.onSelect?.(node)
    }

    function pressRow(node: WorkspaceFilesystemNode, isExpanded: boolean): void {
      selectNode(node)
      if (node.kind === 'directory') props.onDirectoryRowToggle(node.id, !isExpanded)
    }

    function openFile(node: WorkspaceFilesystemNode): void {
      if (node.kind !== 'file') return
      props.onOpenFile?.(node)
      props.onActivate?.(node)
    }

    function handleScroll(event: Event): void {
      if (event.currentTarget instanceof HTMLElement) {
        props.onTopVisibleRowIndexChange(topVisibleFiletreeRowIndex(event.currentTarget))
      }
    }

    function handleRowKeydown(node: WorkspaceFilesystemNode, event: KeyboardEvent): void {
      const rows = collection.value.rows
      const rowIndex = rows.findIndex((row) => row.id === node.id)
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusFiletreeRowAtIndex(scrollViewportRef.value, rowVirtualizer.value, Math.min(rows.length - 1, rowIndex + 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        focusFiletreeRowAtIndex(scrollViewportRef.value, rowVirtualizer.value, Math.max(0, rowIndex - 1))
        return
      }
      if (event.key === 'Home') {
        event.preventDefault()
        focusFiletreeRowAtIndex(scrollViewportRef.value, rowVirtualizer.value, 0)
        return
      }
      if (event.key === 'End') {
        event.preventDefault()
        focusFiletreeRowAtIndex(scrollViewportRef.value, rowVirtualizer.value, rows.length - 1)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        if (node.kind === 'file') openFile(node)
        return
      }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const matchIndex = findTypeaheadRowIndex(rows, rowIndex, event.key)
        if (matchIndex >= 0) {
          event.preventDefault()
          focusFiletreeRowAtIndex(scrollViewportRef.value, rowVirtualizer.value, matchIndex)
        }
        return
      }
      if (node.kind !== 'directory') return
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (!props.expandedKeys.has(node.id)) props.onDirectoryRowToggle(node.id, true)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        if (props.expandedKeys.has(node.id)) props.onDirectoryRowToggle(node.id, false)
      }
    }

    return () => {
      const currentCollection = collection.value
      const virtualRows = rowVirtualizer.value.getVirtualItems()
      const renderedRows =
        virtualRows.length > 0
          ? virtualRows
          : currentCollection.rows.map((row, index) => ({
              key: row.id,
              index,
              start: index * FILETREE_ROW_HEIGHT,
            }))
      const selectedKey = firstFiletreeKey(props.selectedKeys)
      const selectedIndex = selectedKey ? currentCollection.rows.findIndex((row) => row.id === selectedKey) : -1
      const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0
      const loadingKeys = props.loadingKeys ?? EMPTY_KEY_SET
      const openingFileKeys = props.openingFileKeys ?? EMPTY_KEY_SET

      if (props.error && !props.tree) {
        return (
          <FiletreeShell loading={props.isReading}>
            <EmptyState
              icon={<FolderTree size={16} />}
              title={t(FILE_TREE_I18N_KEYS.error)}
              body={
                props.onRetry ? (
                  <Button type="button" variant="default" disabled={props.isReading} onClick={props.onRetry}>
                    <RefreshCw class={props.isReading ? 'animate-spin' : undefined} />
                    {t('error.try-again')}
                  </Button>
                ) : undefined
              }
            />
          </FiletreeShell>
        )
      }

      if (!props.tree) {
        return props.isInitialLoading ? (
          <FiletreeShell loading />
        ) : (
          <FiletreeShell loading={false}>
            <EmptyState icon={<FolderTree size={16} />} title={t(FILE_TREE_I18N_KEYS.empty)} />
          </FiletreeShell>
        )
      }

      if (currentCollection.rows.length === 0) {
        return (
          <FiletreeShell loading={props.isReading}>
            {props.error ? <FiletreeStaleNotice isReading={props.isReading} onRetry={props.onRetry} /> : null}
            <EmptyState icon={<FolderTree size={16} />} title={t(FILE_TREE_I18N_KEYS.empty)} />
          </FiletreeShell>
        )
      }

      return (
        <FiletreeShell loading={props.isReading}>
          {props.error ? <FiletreeStaleNotice isReading={props.isReading} onRetry={props.onRetry} /> : null}
          <ScrollArea
            class="min-h-0 flex-1"
            scrollbarMode="compact"
            viewportRef={scrollViewportRef}
            viewportClass={focusRingInset}
            viewportOnScroll={handleScroll}
          >
            <div
              role="tree"
              aria-label={t(FILE_TREE_I18N_KEYS.ariaLabel)}
              class="relative min-h-full font-sans text-sm"
              style={{ height: `${rowVirtualizer.value.getTotalSize()}px` }}
            >
              {renderedRows.map((virtualRow) => {
                const row = currentCollection.rows[virtualRow.index]
                if (!row) return null
                const childIds = currentCollection.childIdsByParentId.get(row.id) ?? []
                return (
                  <FiletreeTreeRow
                    key={row.id}
                    row={row}
                    rowIndex={virtualRow.index}
                    hasChildItems={
                      row.node.kind === 'directory' && (row.node.hasChildren === true || childIds.length > 0)
                    }
                    isExpanded={props.expandedKeys.has(row.id)}
                    isSelected={props.selectedKeys.has(row.id)}
                    isTabbable={virtualRow.index === tabbableIndex}
                    isLoading={loadingKeys.has(row.id)}
                    isOpeningFile={openingFileKeys.has(row.id)}
                    virtualStart={virtualRow.start}
                    onKeydown={handleRowKeydown}
                    onRowClick={pressRow}
                    onToggleDirectory={props.onDirectoryRowToggle}
                    onSelect={selectNode}
                    onOpenFile={props.onOpenFile || props.onActivate ? openFile : undefined}
                    onDownloadFile={props.onDownloadFile}
                    onRequestTrashFile={props.onRequestTrashFile}
                  />
                )
              })}
            </div>
          </ScrollArea>
          {props.tree.truncated ? (
            <div class="border-t border-border bg-muted px-4 py-1 text-xs text-muted-foreground">
              {t(FILE_TREE_I18N_KEYS.truncated)}
            </div>
          ) : null}
        </FiletreeShell>
      )
    }
  },
})

const FiletreeStaleNotice = defineComponent<{ isReading: boolean; onRetry?: () => void }>({
  name: 'FiletreeStaleNotice',
  props: ['isReading', 'onRetry'],
  setup(props) {
    const t = useT()
    return () => (
      <div
        role="status"
        class="flex items-center justify-between gap-3 border-b border-warning-border bg-warning-surface px-4 py-2 text-xs text-warning"
      >
        <span class="font-medium">{t(FILE_TREE_I18N_KEYS.stale)}</span>
        {props.onRetry ? (
          <Button type="button" size="sm" variant="ghost" disabled={props.isReading} onClick={props.onRetry}>
            <RefreshCw class={props.isReading ? 'animate-spin' : undefined} />
            {t('error.try-again')}
          </Button>
        ) : null}
      </div>
    )
  },
})

const FiletreeShell: FunctionalComponent<{ loading: boolean }> = (props, { slots }) => (
  <div data-filetree="" aria-busy={props.loading || undefined} class="flex min-h-0 flex-1 flex-col">
    {slots.default?.()}
  </div>
)

FiletreeShell.props = ['loading']
