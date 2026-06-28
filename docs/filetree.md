# Filetree

Use this doc for the worktree-scoped file tree view.

## Goal

A read-only, VSCode-style file tree rooted at the current worktree. Treated as a self-contained vertical feature slice parallel to `repos`, `settings`, `terminal`, `remote` per `docs/layering.md`. Server owns the tree shape and the git-status overlay; client owns expand/collapse and selection.

v1 makes no promises about file actions, search, or cross-worktree diff.

## Non-goals (v1)

- No file content preview.
- No editor / Finder / terminal actions from the tree.
- No drag/drop, multi-select, rename, delete, stage, or copy.
- No in-tree search or fuzzy finder.
- No persisted expand state across launches.
- No virtualized rendering.
- No cross-worktree diff.
- No SSH-UI changes beyond what the backend needs to enumerate.

## Core model

Four concepts, not to be collapsed:

- **Worktree root**: absolute path. Identified by the worktree, not by the selected branch — switching branches within the same worktree does not change the root.
- **Tree node**: one `directory` or `file`, identified by a relative POSIX path inside the worktree.
- **Git status overlay**: a tag per node derived from `git status`. v1 only annotates the dirty subset; clean files are unmarked. Independent of `kind`.
- **Expand state**: which directories are open. Component-local only.

## Module boundary

The slice is identified by its files, its stable public surface, and a one-way dependency direction. The architecture guard (`bun run check:architecture`) enforces a subset of these boundaries — see "Enforcement" below. Everything else is review discipline.

### Files owned by this slice

`+` marks files that are new in this slice; unmarked files are existing and modified.

| File | Role |
| --- | --- |
| `src/shared/procedure-schemas.ts` | `+ REPO_PROCEDURE_SCHEMAS.tree` (one entry); extend `SessionStateSchema` and `WorkspacePaneStaticTabOrderEntrySchema` picklists (see "Workspace pane integration") |
| `src/shared/api-types.ts` | `+ RepoTreeNode`, `+ RepoTreeResult`, `+ RepoTreeNodeStatus` (additive) |
| `src/shared/workspace-pane.ts` | extend `WORKSPACE_PANE_STATIC_VIEW_TYPES` and `WORKSPACE_PANE_STATIC_VIEW_SCOPES` with `'files'` |
| `src/shared/i18n/{en,zh,ja,ko}.ts` | new keys: `tab.files`, `workspace-pane-views.files-tooltip`, `filetree.*` (see "i18n") |
| `+ src/server/modules/repo-tree-source.ts` | Source layer: walks FS / invokes SSH; returns `RepoTreeNode[]` (no wire envelope) |
| `+ src/server/modules/repo-tree.ts` | Read layer: `getRepositoryTree`; composes source + git-status overlay into `RepoTreeResult` |
| `src/server/modules/repo-backend.ts` | `+ RepoBackend.getTree` (one method); adapter dispatching local/remote source |
| `src/server/routes/repo.ts` | `+ app.post('/tree', ...)` |
| `src/server/routes/repo-view.ts` | unchanged in v1 (`g` command does not include `'files'`) |
| `+ src/web/filetree-client.ts` | Boundary: `getRepositoryTree(cwd, worktreePath, options?)` |
| `+ src/web/hooks/useRepoTreeRefresh.ts` | Read orchestration + invalidation subscription |
| `+ src/web/components/branch-workspace/FiletreeView.tsx` | Pure view |
| `src/web/components/branch-workspace/workspace-pane-panels.tsx` | `+ files` entry in `BRANCH_WORKSPACE_PANE_PANEL_BY_TYPE`; `+ FilesWorkspacePanePanel` |
| `src/web/workspace-pane/workspace-pane-tab-providers.ts` | `+ FilesWorkspacePaneTabProvider` (icon `FolderTree`); register in `STATIC_WORKSPACE_PANE_TAB_PROVIDERS` and `STATIC_WORKSPACE_PANE_TAB_PROVIDER_BY_TYPE` |

`src/shared/filetree.ts` is intentionally absent: wire shape and domain shape coincide in v1, so the types live in `api-types.ts`. If they diverge, the file is introduced then — not as a stub. Adding any new shared file (`shared/filetree-helpers.ts`, etc.) or splitting `FiletreeView.tsx` requires updating the table above in the same PR — the table is the source of truth for what belongs to this slice.

### Files this slice must not touch

- `src/server/modules/repo-read-paths.ts` — that file is the snapshot/status/PR composite pipeline; `getRepositoryTree` lives in `repo-tree.ts`.
- `src/web/stores/repos/**` — repos store is a runtime-coherent projection of repo truth; the tree is not a projection. The hook maintains its own `loading` / `error` / `stale` slice; nothing else in the app reads it.
- `src/web/repo-client.ts` — repo-client is the boundary for the `repos` slice. New boundary goes in `filetree-client.ts`.
- `src/web/components/StatusList.tsx`, `src/web/components/terminal/**` — reuse color tokens, not components.

### Public surface (the only stable contract)

```ts
// src/shared/procedure-schemas.ts (additive)
export const REPO_PROCEDURE_SCHEMAS: {
  // ...existing entries...
  readonly tree: v.BaseSchema<unknown, unknown, { readonly cwd: string; readonly worktreePath: string; readonly prefix?: string; readonly depth?: number }, never>
}

// src/shared/api-types.ts (additive)
export type RepoTreeNodeStatus = 'clean' | 'modified' | 'staged' | 'untracked' | 'ignored'

export interface RepoTreeNode {
  /** Stable id: relative POSIX path inside the worktree. */
  readonly id: string
  /** Relative POSIX path inside the worktree (matches id; named for readability). */
  readonly path: string
  /** Final path segment, used as the display name. */
  readonly name: string
  readonly parentId: string | null
  readonly kind: 'directory' | 'file'
  readonly status: RepoTreeNodeStatus
}

export interface RepoTreeResult {
  readonly nodes: ReadonlyArray<RepoTreeNode>
  /** True if the result was truncated by `depth` or a node-count cap. */
  readonly truncated: boolean
}

// src/server/modules/repo-backend.ts (additive method on existing interface)
export interface RepoBackend {
  // ...existing methods...
  getTree(worktreePath: string, options?: RepoBackendGetTreeOptions): Promise<RepoTreeResult>
}

export interface RepoBackendGetTreeOptions {
  readonly prefix?: string
  readonly depth?: number
  readonly signal?: AbortSignal
  /** When provided, skip the internal status fetch and use this instead. */
  readonly precomputedStatus?: ReadonlyArray<WorktreeStatus>
}

// src/web/filetree-client.ts
export function getRepositoryTree(
  cwd: string,
  worktreePath: string,
  options?: { readonly prefix?: string; readonly depth?: number; readonly signal?: AbortSignal },
): Promise<RepoTreeResult>

// src/web/hooks/useRepoTreeRefresh.ts
export interface UseRepoTreeRefreshInput {
  readonly repoId: string
  readonly worktreePath: string
}

export interface UseRepoTreeRefreshResult {
  readonly tree: RepoTreeResult | null
  readonly loading: boolean
  readonly error: string | null
  readonly stale: boolean
  refresh(): void
}

export function useRepoTreeRefresh(input: UseRepoTreeRefreshInput): UseRepoTreeRefreshResult

// src/web/components/branch-workspace/FiletreeView.tsx
export interface FiletreeViewProps {
  readonly tree: RepoTreeResult | null
  readonly loading: boolean
  readonly error: string | null
  readonly stale: boolean
  readonly onSelect?: (node: RepoTreeNode) => void
  readonly onActivate?: (node: RepoTreeNode) => void
}

export function FiletreeView(props: FiletreeViewProps): JSX.Element
```

Anything not on this list is internal and may change without notice.

### Reverse direction

`repos`, `settings`, `terminal`, `remote` must not import from any filetree-owned file. If `src/shared/filetree.ts` is created in v2, the same rule applies to it. This rule is enforced by review discipline (see "Enforcement"), not by the architecture guard.

### Layer rules inside the slice

| Layer | File | Input | Output | Forbidden |
| --- | --- | --- | --- | --- |
| Source | `repo-tree-source.ts` | `worktreePath`, options, `AbortSignal`, optional `WorktreeStatus[]` | `{ nodes: RepoTreeNode[]; truncated: boolean }` (no wire envelope) | UI types, locale keys, HTTP, route parsing |
| Read | `repo-tree.ts` | `cwd`, `worktreePath`, options | `RepoTreeResult` | direct fs/SSH (must go through source), UI, HTTP |
| Adapter | `repo-backend.ts` (`RepoBackend.getTree`) | `runWithRepoBackend(cwd)` resolution to local or remote backend | `RepoTreeResult` | new policy / IO logic (must live in source layer) |
| Server boundary | `routes/repo.ts` `/tree` only | Hono context | wire JSON | anything beyond `parseHttpBody` → `getRepositoryTree` → `jsonOr` |
| Client boundary | `web/filetree-client.ts` | `cwd`, `worktreePath`, options | `RepoTreeResult` | state, hooks, retry, caching, derivation |
| Hook | `web/hooks/useRepoTreeRefresh.ts` | `filetree-client`, invalidation events | `UseRepoTreeRefreshResult` | `useReposStore`, terminal hooks, settings, route paths |
| View | `FiletreeView.tsx` | hook output + i18n keys | JSX + optional callbacks | fetch calls, server modules, store mutations |

The source layer is split from the read layer on purpose: FS walking and SSH command invocation are different policies, and the git-status overlay crosses the `WorktreeStatus` boundary. Keeping them apart lets `repo-tree.ts` stay a thin orchestrator that tests without touching the filesystem. The adapter layer (`RepoBackend.getTree`) is existing infra and adds one method; it is not a new layer.

### Enforcement

The architecture guard (`bun run check:architecture`, defined in `scripts/check-architecture.ts`) enforces these boundaries only:

- `src/main/**` must not import `src/web/**` or `src/server/**`.
- `src/web/**` must not import `src/main/**`.
- `src/server/**` and `src/shared/**` must not import `electron`.
- No file may import the aggregate `#/shared/terminal.ts` entrypoint.

Everything in "Anti-coupling rules" below is **review discipline, not machine-checked**. The guard cannot detect, for example, "filetree imported `useReposStore`" or "filetree added a sibling-slice internal import". Treat those rules as load-bearing: they exist precisely because the guard does not cover them.

## Anti-coupling rules

Review-blocking. A PR that violates any rule is rejected even if it works.

1. **No imports across slice boundaries except via the public surface.** Filetree imports only the public surface of `repos` (as defined by `docs/layering.md`); nothing from `src/web/stores/repos/refresh-state.ts`, `branch-actions.ts`, terminal hooks, settings, or worktree-bootstrap.
2. **No shared mutable state.** Filetree's `loading` / `error` / `stale` lives in `useRepoTreeRefresh`. Do not extend `useReposStore`, `useSettingsStore`, or share `useRef` with terminal components.
3. **No piggybacking on other read paths.** `getRepositoryTree` accepts an optional `precomputedStatus: WorktreeStatus[]` from callers but does not call `getRepositoryStatus` itself. It must remain usable without the composite pipeline.
4. **No new event channels.** The hook subscribes to `repo-query-invalidated` via the existing `src/web/server-invalidation-ingress.ts`; it does not introduce a new event channel and does not publish events.
5. **No cross-feature refactors buried in a filetree PR.** If a filetree feature needs a change inside another slice, that change is its own PR with its own justification.
6. **No drive-by cleanups in other slices.** Coupling starts with small favors. Filetree PRs touch filetree-owned files only.

## Wire protocol

One POST endpoint: `POST /api/repo/tree`. Body: `REPO_PROCEDURE_SCHEMAS.tree`. Response: `RepoTreeResult` wrapped in the existing `jsonOr` envelope (failure → `{ nodes: [], truncated: false }`, matching `getRepositorySnapshot` semantics).

```ts
// src/shared/procedure-schemas.ts
tree: v.object({
  cwd: v.string(),                       // repo locator (matches other repo endpoints)
  worktreePath: v.string(),              // absolute path of the tree root (validated against the worktree list in repo-tree.ts)
  prefix: v.optional(RepoTreePrefixSchema),  // strictly relative POSIX path inside the worktree (no `..`, no `/`, no control chars)
  depth: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10))),
})

// src/shared/api-types.ts
type RepoTreeNodeStatus = 'clean' | 'modified' | 'staged' | 'untracked' | 'ignored'

interface RepoTreeNode {
  readonly id: string
  readonly path: string
  readonly name: string
  readonly parentId: string | null
  readonly kind: 'directory' | 'file'
  readonly status: RepoTreeNodeStatus
}

interface RepoTreeResult {
  readonly nodes: ReadonlyArray<RepoTreeNode>
  readonly truncated: boolean
}
```

A flat `nodes[]` rather than a nested tree — single-pass server build, future incremental updates are "patch this id", future virtual scroll consumes it directly, the view's parent/child index is a `useMemo`.

The shapes live in `api-types.ts` and are transport types, not domain types. Wire and domain coincide in v1; if they diverge later, the divergence is fixed at the hook boundary by mapping wire → domain, and types move to `src/shared/filetree.ts`.

Refresh triggering: v1 hooks into the existing `repo-query-invalidated` event with `query: 'repo-snapshot'`. The tree refreshes whenever the snapshot refreshes (matches the user mental model: git status changed → tree re-renders the dots). A dedicated `'repo-tree'` query kind is intentionally not added in v1.

## Design principles

- **Server-first tree truth.** The server uses `tinyglobby` + a minimal `.gitignore` reader locally, and a `find`-based command for SSH remote (per `docs/ssh-remote.md`'s `local-decision, remote-execution`). The client never enumerates directories or runs `git status`.
- **Reuse the workspace pane.** New static view, `scope = 'worktree'` (matches `changes`). Plugs into `WorkspacePaneStaticTabProvider`: tab ordering, dnd-kit reorder, keyboard nav, close affordance, tooltip layer, compact popover all come for free. Gated by `hasWorktree` like `changes`.
- **Read-only in v1.** The component exposes optional `onSelect` / `onActivate` callbacks so future wiring does not require a breaking prop change; selection (single-click highlight) is the only visible interaction.
- **Status-only overlay.** Dirty files get a small dot before the name in `--color-success` / `--color-warning` / `--color-danger` / `--color-muted-foreground`. Clean files have no marker. This avoids visual collision with `StatusList`'s `M A` two-character codes.
- **Lean client state.** Expand/collapse is `useState` (local per `docs/state-sync.md`). Tree shape and overlay are runtime-coherent, refreshed via `repo-query-invalidated`. Scroll position and selection are also local.

## Workspace pane integration

`src/shared/workspace-pane.ts`:

- Add `'files'` to `WORKSPACE_PANE_STATIC_VIEW_TYPES`.
- Add `WORKSPACE_PANE_STATIC_VIEW_SCOPES.files = 'worktree'`.
- Derived constants follow automatically: `WORKSPACE_PANE_WORKTREE_STATIC_VIEW_TYPES` includes `'files'`; `WORKSPACE_PANE_VIEW_TYPES = [...WORKSPACE_PANE_STATIC_VIEW_TYPES, 'terminal']` includes `'files'`; `WORKSPACE_PANE_SESSION_VIEW_TYPES = WORKSPACE_PANE_VIEW_TYPES` includes `'files'`; `isWorkspacePaneViewType` accepts `'files'`.

`src/shared/procedure-schemas.ts`:

- Extend `preferredWorkspacePaneViewByBranchByRepo` picklist from `['status', 'changes', 'history', 'terminal']` to `['status', 'changes', 'history', 'files', 'terminal']`. Without this, session state containing `'files'` fails to deserialize.
- Extend `WorkspacePaneStaticTabOrderEntrySchema` to include `v.object({ type: v.literal('files'), id: v.literal('files') })`.

`src/web/workspace-pane/workspace-pane-tab-providers.ts`:

- Add `FilesWorkspacePaneTabProvider` (icon `FolderTree`, label key `tab.files`, tooltip key `workspace-pane-views.files-tooltip`).
- Register in `STATIC_WORKSPACE_PANE_TAB_PROVIDERS` and `STATIC_WORKSPACE_PANE_TAB_PROVIDER_BY_TYPE`.

`src/server/routes/repo-view.ts`: intentionally not extended in v1. Adding `'files'` is a one-line change later if product wants `g files`.

## Visual rules

Per `docs/ui-conventions.md`:

- Tab label uses sentence case (`Files`); status chips use lowercase.
- The tree body uses the existing `--color-*` tokens (no new colors introduced).
- Container borders (workspace toolbar, sidebar, list dividers) stay on Tailwind border utilities — they belong to the surrounding container's box, not a separate child element.
- Inline vertical seams inside toolbar siblings use `<Separator orientation="vertical" />`, not hand-rolled `bg-separator w-px` or `border-l border-separator`. The tree's indent guides are container-level chrome (left border on the tree body), so they use Tailwind border utilities.
- Focus rings use `focusRingInset` from `src/web/components/ui/focus.ts`. Tree rows sit inside scroll containers, which is exactly the case the doc calls out for inset focus rings.
- Keyboard navigation (`ArrowUp` / `ArrowDown` / `ArrowLeft` / `ArrowRight` / `Enter`) is wired through the existing `src/web/keyboard/` system. `ArrowLeft` collapses a focused directory, `ArrowRight` expands or moves into the first child, `Enter` is reserved for the future `onActivate`.

## i18n

Add the following keys to every locale (`en.ts`, `zh.ts`, `ja.ts`, `ko.ts`):

- `tab.files` — short tab label.
- `workspace-pane-views.files-tooltip` — tooltip text, with optional `{branch}` interpolation.
- `filetree.empty` — shown when the worktree has no visible files after `.gitignore` filtering.
- `filetree.no-worktree-title` / `filetree.no-worktree-body` — shown when the branch has no worktree.
- `filetree.truncated` — shown as a footer note when `truncated` is `true`.
- `filetree.error` — shown when the read fails.

Per `AGENTS.md` i18n rules, the component calls `t()` with a static key (no concatenation). Define a typed key map at the top of `FiletreeView.tsx`:

```ts
const FILE_TREE_I18N_KEYS = {
  empty: 'filetree.empty',
  noWorktreeTitle: 'filetree.no-worktree-title',
  noWorktreeBody: 'filetree.no-worktree-body',
  truncated: 'filetree.truncated',
  error: 'filetree.error',
} as const satisfies Record<string, string>
```

## State lifecycle summary

| State class | Example | Where it lives | Survives launch? |
| --- | --- | --- | --- |
| Local | expanded directory ids, focused row id, scroll position | `useState` / ref in `FiletreeView` | No |
| Runtime-coherent | tree shape, git-status overlay | server, refreshed via invalidation | server-owned |
| Restorable | preferred view per branch (`'files'`) | session state, existing path | Yes |
| Restorable | tab strip order | existing tab order persistence | Yes |

## Testing

- `src/server/modules/repo-tree-source.test.ts` (or `repo-tree.test.ts`): local FS walk, `.gitignore` filter, `depth` truncation, `.git` hard filter, signal abort.
- `src/web/components/branch-workspace/FiletreeView.test.tsx`: render a fixed tree, verify expand/collapse, status dot, empty/error states.
- `src/web/hooks/useRepoTreeRefresh.test.ts`: invalidation triggers refetch; abort signal cancels in-flight fetch (the hook must hold an `AbortController` and cancel the previous request when inputs change).
- Route test: `POST /api/repo/tree` parses correctly; backend failure returns empty result.

## Rollout

- **PR 1** — types + protocol + tab provider + workspace-pane constants + session-schema picklist extension. No behavior change. No new test fixtures — existing session-state tests must keep passing because the picklist widens (existing literal values remain valid). `'files'` session-restore coverage lands with PR 4.
- **PR 2** — `repo-tree-source.ts` (local FS implementation), `repo-tree.ts`, route, `RepoBackend.getTree` (local impl).
- **PR 3** — `filetree-client.ts`, `useRepoTreeRefresh.ts` (must `AbortController` on input change).
- **PR 4** — `FiletreeView`, panel wiring, i18n keys for all locales, session-restore test coverage for `'files'`.
- **PR 5** — `repo-tree-source.ts` SSH remote implementation (per `docs/ssh-remote.md`'s `local-decision, remote-execution`: gitignore parsed locally, enumeration runs on the remote).

Each PR is independently reviewable and shippable. Local repos are fully usable without PR 5.

## Future work (post-v1)

Action surface (`onActivate` → open in editor, `onReveal` → reveal in Finder, `onOpenTerminal`); selective rendering via `@tanstack/react-virtual` once measured workloads exceed ~1k visible nodes; persisted expand state under a session-restore key (only if user feedback asks for it); cross-worktree diff (likely a separate feature); dedicated `'repo-tree'` invalidation query kind if selective refetch becomes necessary.
