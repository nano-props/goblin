# Android Terminal Font Asset

## Selected Font

- Family: Maple Mono CN
- Style: Regular
- Local Android resource: `android/app/src/main/res/font/goblin_terminal_cjk_regular.ttf`
- Upstream project: https://github.com/subframe7536/maple-font
- Upstream release: `v7.9`
- Upstream archive: `MapleMono-CN-unhinted.zip`
- Archive URL: https://github.com/subframe7536/maple-font/releases/download/v7.9/MapleMono-CN-unhinted.zip
- Archive SHA-256: `d41cb72721e99cfe4fbd1a7b0f182a013457de46aa612018f924dd024699d3b9`
- License: SIL Open Font License 1.1

## Selection Rationale

Goblin Android terminal needs readable Chinese and mixed Chinese/ASCII terminal output. Maple Mono CN is selected because the upstream project documents Chinese/Japanese glyph support and Chinese/English 2:1 alignment, which matches the terminal readability direction selected during brainstorming.

The non-NF CN package is used for this phase because terminal CJK readability is the goal. Nerd Font icon coverage is outside this phase and would increase the Android asset footprint.

## Integration Constraints

- Use only the Regular face in this phase.
- Keep the local font resource at or below 40 MiB.
- Load the font through Android `Resources.getFont(...)`.
- Do not use Web `.woff2` assets in Android native rendering.
- Fall back to `Typeface.MONOSPACE` if Android rejects or cannot load the bundled resource.
