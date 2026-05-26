# Project Notes

## Git operation boundaries

- Read-only git commands may run concurrently.
- Network git commands (`fetch`, `pull`, `push`) are cancellable and coalesced per repo where applicable.
- Avoid adding destructive git operations to the app. Prefer copying repository/worktree context so the user can run high-risk commands manually or hand them to an AI/terminal workflow.
- If a destructive operation is introduced later, design its stale-state, dirty-state, cancellation, and refresh-after-failure behavior explicitly before implementation.

## Dependency and import conventions

- When adding packages to `package.json`, use the latest available version and pin the exact version (no `^` or other range prefixes).
- Source imports should use the repo alias with explicit TypeScript extensions, e.g. `#/renderer/stores/i18n.ts` or `#/main/settings.ts`.
- Do not add re-export shim files. Import from the canonical source module directly instead.

## Verification

- Unit tests run with Vitest via `bun run test`; watch mode is `bun run test:watch`.
- `bun run typecheck` covers main, renderer, and test-specific TypeScript configs.

## Repo loading and refresh architecture

- UI loading, busy, disabled, error, stale, and loaded timestamps should be derived from `repo.resources`.
- Do not reintroduce `repo.ops` or expose operation execution state on `RepoState`.
- Execution-only state such as queue lane, request id, latest-wins replacement, and exclusive busy checks belongs in `runtime.ts` / `operation-runner.ts`.
- Multi-resource sequencing belongs in `refresh-workflows.ts`; keep `refresh.ts` focused on single-resource RPC/data-write primitives.
- Prefer `resource-runner.ts` for simple read-resource lifecycle code. Keep specialized resources such as PR fan-out or branch actions explicit when a generic abstraction would obscure behavior.
- UI visual presentation should not surface runtime-only operation state. Runtime busy checks are for execution/concurrency safety and click gating.

## English UI copy conventions

- Use Title Case for native menu items.
- Use sentence case for buttons, actions, headings, and explanatory text.
- Use lowercase for status chips and badges, e.g. `open`, `dirty`, `no upstream`, `no worktree`, `modified`.
- Preserve official casing for proper nouns and acronyms, e.g. `GitHub`, `VS Code`, `PR`.
- Preserve raw git/status data as-is, e.g. branch names, paths, `M`, `A`, and `??`.

## Path display conventions

- User-visible paths under the home directory should be displayed with `~`, e.g. `$HOME/Developer/project` as `~/Developer/project`. Use the existing `tildify` helpers instead of hand-rolled replacements.

## Privacy-safe examples

- Do not use real user names, machine names, personal paths, emails, tokens, or company-internal identifiers in code examples, tests, docs, or snapshots. Use generic placeholders such as `user`, `alice`, `example`, `$HOME`, or `example.com` instead.
