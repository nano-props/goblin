// Web-side test helper for stubbing `#/web/stores/i18n.ts`.
//
// Why this exists:
//   `src/web/stores/i18n.ts` runs `i18next.use(initReactI18next).init({…})`
//   at module load. That call is the one that wires the i18next
//   singleton into `react-i18next`'s module-scoped closure so `<Trans>`
//   can find an instance. A naïve mock that replaces the whole module —
//   `vi.mock('#/web/stores/i18n.ts', () => ({ useT: … }))` — drops the
//   side effect. Components that reach for `<Trans i18nKey=…>` (notably
//   `BranchActionDialogHost`'s `action.confirm-push-protected-body`)
//   then emit `NO_I18NEXT_INSTANCE` at runtime, even though the test
//   still passes because the mocked `useT` returns the raw key.
//
// What this module does:
//   The `vi.mock` call below runs as a side effect of evaluating this
//   module. Vitest hoists `vi.mock` calls to the top of every file
//   that imports this module, so the partial mock is registered
//   before the test file's own imports of `#/web/stores/i18n.ts`.
//   The factory delegates to `importOriginal()` so the real module's
//   top-level `i18next.use(initReactI18next).init({…})` still runs,
//   then overrides only `useT` to return raw keys.
//
// Usage:
//   ```ts
//   import { stubI18n } from '#/test-utils/i18n-mock.ts'
//   // (no call needed — importing is the call)
//   ```
//
// Tests that need a richer override (e.g. `useI18nStore` returning a
// specific selector result, or `useT` translating specific keys) should
// write their own `vi.mock(import('#/web/stores/i18n.ts'), async
// (importOriginal) => { … })` at the top of the test file and
// re-export everything from the real module by spreading the original.

import { vi } from 'vitest'

vi.mock(import('#/web/stores/i18n.ts'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    // Return raw i18n keys so tests can assert on key names without
    // depending on a translated dictionary. Everything else from the
    // real module is re-exported so the i18next init side effect runs.
    useT: (() => (key: string) => key) as typeof actual.useT,
  }
})

/** Marker export so test files can write `import { stubI18n }` to
 *  opt into the partial mock side effect without producing unused
 *  import warnings. */
export function stubI18n(): void {}
