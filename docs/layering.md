# Layering

Use this doc for feature layering rules.

## Goal

- Organize code by feature first.
- Split by concern only when needed.
- Keep ownership and read/write direction clear.

## Two axes

### Vertical: module / feature

- Treat each business area as a feature slice.
- Prefer feature-local files over broad cross-app buckets.
- A feature may span `src/server/`, `src/web/`, and `src/shared/`, but it should still read as one feature.

Examples:

- settings
- repos
- terminal
- realtime

### Horizontal: concern layers inside a feature

Use only the layers the feature needs.

#### 1. Boundary layer

- Handles protocol and transport boundaries.
- Parses input, calls the next layer, returns output.
- Should stay thin.

Typical files:

- `src/server/routes/*`
- `*-client.ts`

#### 2. Read layer

- Exposes read models, snapshots, and query hooks.
- Should stay read-only.
- May define query keys, query options, and refetch behavior.

Typical files:

- `*-queries.ts`
- `*-snapshot.ts`
- read-side selectors or projection readers

#### 3. Write layer

- Owns mutation orchestration.
- Runs writes, follow-up refresh, invalidation, and local projection/cache updates.
- This is the main place for write flow.

Typical files:

- `*-write-paths.ts`
- focused mutation orchestration modules

#### 4. Source layer

- Talks to persistence, durable storage, or other authoritative systems.
- Returns authoritative state after read/write operations.
- Do not add this layer unless storage or authoritative source rules are distinct.

Typical files:

- `*-source.ts`
- storage adapters

#### 5. Runtime facade layer

- Optional layer for renderer-facing feature APIs.
- Combines read models and UI-safe actions.
- Use it when components benefit from a stable feature API.
- This is not a default layer.
- Do not use it as a catch-all for feature logic.

Typical files:

- `runtime-*.ts`

## Default flow

The default flow should look like this:

- read: boundary -> read layer -> UI
- write: UI -> boundary/client -> write layer -> source layer -> invalidation/cache/projection update -> UI

Do not mix read and write concerns unless the feature is still trivial.

## When not to split

Do not add layers just because the pattern exists.

Keep a feature in one file or one small cluster when most of these are true:

- the feature has one simple read path and one simple write path
- there is no cache coordination beyond a direct state update or refetch
- the UI only has one caller
- persistence details are not yet distinct from the write flow
- the file is still easy to explain and review as one unit

Small features should stay small.

## When to split

Split a feature into more layers when one of these becomes true:

- reads are shared by multiple callers or need their own query lifecycle
- writes need invalidation, follow-up refresh, optimistic/local projection updates, or native projection
- persistence or authoritative storage rules have become distinct from write orchestration
- UI components are starting to repeat the same mutation flow
- route or client code is accumulating business decisions

Use splitting to reduce confusion, not to satisfy a template.

## State-aware rule

When naming types, modules, or slices, keep these state classes visible when they matter:

- local
- runtime-coherent
- restorable

Use those distinctions to decide ownership first, then choose the layer.

## Naming rule

- Name modules by feature first, then by layer role.
- Prefer names that reveal responsibility in the flow.
- Use the narrowest stable name that matches the file's job.

Prefer:

- `routes/settings.ts`
- `settings-queries.ts`
- `settings-write-paths.ts`
- `settings-source.ts`
- `runtime-settings-github.ts`

Avoid broad catch-all names like:

- `settings-service.ts`
- `settings-controller.ts`
- `repo-manager.ts`

Use `service` or `controller` only when that term is the real stable boundary and will not mix multiple concerns.

## Practical rules

- Start by creating a feature file or feature folder, not a global `services/` bucket.
- Add a separate read layer only when reads become shared or stateful enough to justify it.
- Add a separate write layer once mutations need orchestration, invalidation, or cache updates.
- Add a source layer only when persistence or authoritative storage logic becomes distinct.
- Add a runtime facade only when the UI benefits from a stable feature-facing API.
- Skip layers you do not need.

## Current repo examples

Use the current codebase as a guide, not as a rigid template.

### Settings

- boundary: `src/server/routes/settings.ts`, `src/web/app-data-client.ts`
- read: `src/web/settings-queries.ts`
- write: `src/server/modules/settings-write-paths.ts`, `src/web/settings-write-paths.ts`
- source: `src/server/modules/settings-source.ts`
- runtime facade: `src/web/runtime-settings-*.ts`

This is a good example of a feature that has grown enough to justify explicit read and write layers.
It also shows a feature where a separate source layer makes sense.

### Repos

- boundary: repo HTTP routes and renderer transport entrypoints
- write: `src/web/stores/repos/lifecycle-write-paths.ts`
- runtime projection/facade: `src/web/stores/repos/store.ts`, related repo store slices
- restorable/runtime distinction: repo store types and lifecycle modules

This is a good example of a feature that should stay feature-first, even when its runtime projection is store-heavy instead of query-heavy.
It also shows that not every complex feature needs a separate runtime facade layer.

### Smaller UI interactions

- keep the logic local when it is only component interaction state
- only extract a runtime facade or write layer when the interaction starts to coordinate shared reads or writes

Examples include dialog-local input state and short-lived pending/error state.
These usually do not need a source layer or a runtime facade layer.

## Smells

Refactor when one of these happens:

- one file owns both complex reads and complex writes
- route files start containing business orchestration
- query files start patching mutation results directly in many places
- UI components start owning feature mutation flow
- a vague `service` or `controller` file becomes the catch-all for the feature

## Rule of thumb

If you can explain a feature as:

- "this is the boundary"
- "this is the read side"
- "this is the write side"
- "this is the source"

then the layering is probably clear enough.
