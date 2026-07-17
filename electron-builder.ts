import type { Configuration } from 'electron-builder'
import { ELECTRON_ASAR_UNPACK_PATTERNS } from '#scripts/electron-packaging.ts'

const config: Configuration = {
  appId: 'goblin.app',
  productName: 'Goblin',
  // Top-level icon is consumed by the mac build (`assets/icon-mac-1024.png`,
  // a 1024x1024 PNG as macOS expects). The Windows build uses the
  // multi-resolution `assets/icon.ico` (16/32/48/256 frames).
  icon: 'assets/icon-mac-1024.png',
  directories: {
    output: 'release',
  },
  files: [
    'dist/server/**/*',
    // Keep these runtime-loaded TS sources in the asar. Main resolves `#/*`
    // imports through Electron's native TS loader, so removing these globs
    // breaks packaged builds even though dev still works.
    'src/main/**/*.ts',
    'src/node/**/*.ts',
    'src/system/**/*.ts',
    'src/server/**/*.ts',
    'src/shared/**/*.ts',
    'dist/preload/**/*',
    'dist/web/**/*',
    'package.json',
    '!src/**/*.test.ts',
    '!**/*.map',
  ],
  extraResources: [{ from: 'resources/terminal-bin', to: 'terminal-bin' }],
  // The embedded server runs with Electron's ASAR filesystem disabled so
  // workspace paths always have native OS semantics. Keep its complete
  // runtime dependency closure on the real filesystem.
  asarUnpack: [...ELECTRON_ASAR_UNPACK_PATTERNS],
  win: {
    // Windows requires a multi-resolution .ico for proper taskbar and
    // file explorer rendering (16/32/48/256 frames embedded).
    icon: 'assets/icon.ico',
    // NSIS installer is the standard "install for current user" path. The
    // oneClick / perMachine toggles below match what most modern Electron
    // apps ship. code signing is intentionally left unset — distribute
    // unsigned builds behind a documented `xattr -dr com.apple.quarantine`
    // equivalent on Windows (right-click → More → Properties → Unblock, or
    // `Unblock-File` in PowerShell).
    target: [{ target: 'nsis', arch: ['x64', 'arm64'] }],
    // Force arch into the filename. NSIS's default omits the suffix on
    // x64, which would make `Goblin-0.1.0.exe` and
    // `Goblin-0.1.0-arm64.exe` sort next to each other with no hint
    // of which is which.
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
  },
  mac: {
    category: 'public.app-category.developer-tools',
    extendInfo: {
      // Required for macOS to show Goblin in System Settings → Notifications
      // and to allow Banner/Alert style notifications. Without this key the
      // app either won't appear in the notification list at all, or will be
      // locked to the silent "None" style with no user-visible controls.
      NSUserNotificationAlertStyle: 'alert',
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: 'Folder',
          CFBundleTypeRole: 'Viewer',
          LSHandlerRank: 'Alternate',
          LSItemContentTypes: ['public.folder'],
        },
      ],
    },
    // electron-builder organizes builds by arch, so any `dir` here would be
    // emitted for every arch declared on dmg. `build.ts install` picks the
    // host-arch directory out of `release/mac*/` itself.
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'dir', arch: ['arm64', 'x64'] },
    ],
    identity: null,
    // Force arch into the filename. electron-builder's default omits the
    // suffix on x64, which would make `Goblin-0.1.0.dmg` (intel) and
    // `Goblin-0.1.0-arm64.dmg` (apple silicon) sort next to each other in
    // releases with no hint of which is which.
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },
}

export default config
