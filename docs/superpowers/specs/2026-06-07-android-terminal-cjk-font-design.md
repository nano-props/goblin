# Android Terminal CJK Font Design

## Summary

Goblin Android terminal output should default to a terminal-specific CJK monospace typeface so Chinese, English, numbers, paths, and command output no longer feel horizontally compressed.

This is a display-layer change only. It must not change SSH transport, PTY behavior, terminal sessions, reconnect, foreground service behavior, terminal input, or repository/workspace ownership.

## Goals

- Improve Android terminal readability for Chinese and mixed Chinese/ASCII output.
- Replace the current Android terminal renderer typeface choice of `Typeface.MONOSPACE` with a bundled CJK monospace terminal font.
- Use the same typeface for `TerminalRenderer` rendering and metric measurement so cols/rows remain aligned with visible glyphs.
- Keep the change local to the Android terminal view path.
- Preserve the existing font-size menu, fit-to-screen behavior, horizontal scrolling, scrollback, input handling, and session lifecycle.
- Keep the asset footprint conservative by adding one Regular font face only.

## Non-goals

- Do not add a font selection UI.
- Do not add Bold or Italic terminal fonts.
- Do not change the Web terminal font system.
- Do not change terminal emulator parsing, SSH, PTY, session manager, reconnect, or foreground service behavior.
- Do not add runtime font downloads.
- Do not use Android downloadable fonts or a system font provider.
- Do not solve unrelated terminal layout or heartbeat issues.

## Current State

`GoblinTerminalView` owns the Android native terminal rendering surface. It creates a Termux `TerminalRenderer` with:

```kotlin
TerminalRenderer(currentFontSizeSp.spToPx(), Typeface.MONOSPACE)
```

The renderer's `fontWidth` and `fontLineSpacing` are used to compute terminal cols/rows. A recent local change also applies `TerminalCellWidthScale = 1.12f` before calculating grid columns.

This can reduce visual density by lowering the number of terminal columns, but it does not change the glyph shape. Chinese and mixed Chinese/ASCII output can still feel narrow because Android's default `Typeface.MONOSPACE` is not optimized for this terminal CJK use case.

The Web app already has `MapleMono-NF-CN-*.woff2` assets under `src/web/assets/fonts/`, but the Android terminal renderer path does not currently load those assets. Android production code should not assume the existing Web `.woff2` files are directly usable by `TerminalRenderer`; the implementation must use an Android-loadable TTF/OTF asset or explicitly verify the chosen format before integration.

## Selected Approach

Bundle a single Regular CJK monospace terminal font for Android and use it as the default terminal renderer typeface.

The first implementation should not add settings. A single default keeps the scope small, makes the behavior consistent, and avoids adding persistence, migration, and UI surface before there is a demonstrated need.

The font choice should prioritize:

- readable Chinese glyphs at phone terminal sizes;
- stable mixed Chinese/ASCII monospace behavior;
- acceptable license for app bundling;
- Android `Typeface` load compatibility;
- reasonable APK size.

If the selected font cannot pass license, format, or size review, implementation should stop and revisit the font choice before modifying production rendering code.

## Architecture

### `GoblinTerminalView`

`GoblinTerminalView` remains the only Android native terminal Canvas view.

Responsibilities retained:

- Bind to `RemoteTerminalEmulatorController`.
- Render the active Termux `TerminalEmulator`.
- Own scrollback and horizontal offset state.
- Translate touch, hardware key, and IME input into terminal bytes.
- Recreate `TerminalRenderer` when the terminal font size changes.
- Calculate terminal cols/rows from renderer metrics.

New responsibility:

- Use the terminal typeface provider when creating `TerminalRenderer`.

It should not directly own font asset lookup details. It should receive or create the terminal typeface through a small helper so the rendering code remains focused.

### Terminal Typeface Helper

Add a small helper near the terminal UI package, for example `TerminalTypefaceProvider`.

Responsibilities:

- Load the bundled Android terminal font from `R.font.goblin_terminal_cjk_regular`.
- Cache the resolved `Typeface` where appropriate.
- Return `Typeface.MONOSPACE` if the bundled font cannot be loaded.

Non-responsibilities:

- It does not decide terminal font size.
- It does not render text.
- It does not expose a user setting.
- It does not own session or emulator state.

### Android Font Asset

Add one Regular CJK monospace font asset to the Android app.

Expected asset shape:

- Android-loadable TTF or OTF preferred.
- Regular weight only.
- Stored as `android/app/src/main/res/font/goblin_terminal_cjk_regular.ttf` or `.otf`.
- Loaded with Android `Resources.getFont(...)`; the app minSdk is 26, so no new font-loading dependency is required.
- License and attribution captured before production use.

The implementation plan should verify whether reusing the Web project's Maple Mono CN source is acceptable and whether a TTF/OTF variant is available. If not, choose another CJK monospace terminal font with a compatible license.

### Grid Metrics

Grid calculation should continue to use the `TerminalRenderer` metrics:

- `renderer.fontWidth`
- `renderer.fontLineSpacing`

The renderer must be constructed with the same terminal typeface that is visible on screen. This keeps visual glyph width and remote PTY cols/rows synchronized.

`TerminalCellWidthScale` may remain if needed after visual calibration, but it should be treated as a density compensation, not the main fix. If the bundled font resolves the compressed feel without extra compensation, implementation should reduce or remove unnecessary width scaling rather than stacking adjustments.

## Data Flow

1. `TerminalScreen` owns `terminalFontSizeSp` and passes it to `AndroidTerminalViewport`.
2. `AndroidTerminalViewport` creates or updates `GoblinTerminalView`.
3. `GoblinTerminalView` resolves the terminal typeface through the helper.
4. `GoblinTerminalView` creates `TerminalRenderer(fontPx, terminalTypeface)`.
5. `TerminalRenderer` renders the active Termux `TerminalEmulator` to the Canvas.
6. `updateGrid()` reads renderer metrics and resizes the remote terminal to the derived cols/rows.

SSH output, emulator append behavior, input byte routing, and session persistence remain unchanged.

## Error Handling

Font loading must fail soft.

- If the bundled font is missing, unreadable, or rejected by Android, return `Typeface.MONOSPACE`.
- Do not crash terminal screen creation because of font loading.
- Do not surface a modal, toast, or banner for fallback; the terminal should remain usable.
- Do not interrupt SSH sessions or terminal input/output when fallback happens.

Implementation should add tests or seams that make fallback behavior verifiable without relying on a broken packaged APK.

## Testing And Verification

Automated verification:

- Unit test the typeface helper fallback path.
- Keep `GoblinTerminalViewLayoutTest` coverage for font-size clamping, grid size, scrollback offset, horizontal offset, and cell-width calculation.
- Update `terminalCellWidthPx` expectations only after final calibration.
- Run Android Kotlin compilation:

```bash
cd "android"
./gradlew ":app:compileDebugKotlin"
```

- Run focused terminal tests:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.*"
```

Manual verification on Android:

- Open an SSH terminal.
- Run mixed Chinese/ASCII samples such as:
  - `pwd` in a path containing Chinese directory names.
  - `git status --short` with Chinese filenames.
  - `printf '中文 English 123 /home/dev/项目\n'`.
  - `codex ai` with Chinese prompts.
- Verify the default rendering no longer feels horizontally compressed.
- Verify long paths wrap or scroll consistently.
- Verify fit-to-screen and original-width modes still work.
- Verify font smaller/larger/reset still recreates the renderer and keeps terminal cols/rows aligned.
- Verify scrollback, touch horizontal scrolling, keyboard input, paste, reconnect, and close still behave as before.

## Implementation Scope

Expected source changes:

- Add one Android font asset.
- Add a terminal typeface helper in the Android terminal UI package.
- Modify `GoblinTerminalView` renderer initialization and font-size update path to use the helper.
- Add or adjust terminal layout/typeface tests.

Expected unchanged areas:

- `SshTerminalService`
- `TerminalController`
- `TerminalSessionManager`
- `RemoteTerminalEmulatorController`
- `RemoteTerminalOutput`
- `TerminalScreen` session and action logic
- Web terminal font files and CSS

## Engineering Principles

- KISS: one default terminal CJK mono font, one helper, no settings UI.
- YAGNI: no font picker, no multiple weights, no runtime downloads.
- DRY: one provider is the single source for Android terminal typeface resolution.
- SOLID: keep font loading separate from terminal rendering and keep session/transport layers untouched.

## Acceptance Criteria

- Android terminal Chinese mixed output visually aligns with the selected "terminal-specific CJK typeface" direction from the brainstorming comparison.
- Terminal startup succeeds even when the bundled font cannot be loaded.
- Renderer metrics and visible typeface stay synchronized after initial load and font-size changes.
- Terminal behavior does not regress for output, input, scrollback, horizontal scrolling, fit-to-screen, reconnect, and close.
- New dependency or asset license, format, and size checks are documented before production integration.
