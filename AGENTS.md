# Project Notes

## Git boundaries

- Read-only git commands may run concurrently.
- Keep network git commands (`fetch`, `pull`, `push`) cancellable and coalesced per repo where applicable.
- Avoid adding destructive git operations to the app; prefer handing repository/worktree context to the user, terminal, or AI workflow.
- If a destructive operation is introduced, design its safety, cancellation, and recovery behavior explicitly first.

## Dependency and import conventions

- When adding packages to `package.json`, use the latest available version and pin the exact version (no `^` or other range prefixes).
- Source imports should use the repo alias with explicit TypeScript extensions, e.g. `#/renderer/stores/i18n.ts` or `#/main/settings.ts`.
- Do not add re-export shim files. Import from the canonical source module directly instead.

## Verification

- Run unit tests with `bun run test`; use `bun run test:watch` for watch mode.
- Run TypeScript verification with `bun run typecheck`.

## English UI copy conventions

- Use Title Case for native menu items.
- Use sentence case for buttons, actions, headings, and explanatory text.
- Use lowercase for status chips and badges, e.g. `open`, `dirty`, `no upstream`, `no worktree`, `modified`.
- Preserve official casing for proper nouns and acronyms, e.g. `GitHub`, `VS Code`, `PR`.
- Preserve raw git/status data as-is, e.g. branch names, paths, `M`, `A`, and `??`.

## UI component conventions

- Prefer shadcn/ui primitives in `src/renderer/components/ui/`; adapt them to the current app design, including density, colors, and interaction states, instead of creating one-off controls or styles.
- For forms, use shared primitives such as `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, and `Input`. Keep label, control, helper, and error spacing consistent and layout-stable.

## Path display conventions

- Display user-visible paths under the home directory with `~`, e.g. `$HOME/Developer/project` as `~/Developer/project`. Use existing `tildify` helpers instead of hand-rolled replacements.

## Privacy-safe examples

- Use generic placeholders in examples, tests, docs, and snapshots. Do not include real user names, machine names, personal paths, emails, tokens, secrets, or company-internal identifiers.
