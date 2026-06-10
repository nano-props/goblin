import type { Configuration } from 'electron-builder'

const config: Configuration = {
  appId: 'goblin.app',
  productName: 'Goblin',
  icon: 'assets/icon-mac-1024.png',
  directories: {
    output: 'release',
  },
  npmRebuild: false,
  files: [
    'dist/server/**/*',
    // Keep these runtime-loaded TS sources in the asar. Main resolves `#/*`
    // imports through Electron's native TS loader, so removing these globs
    // breaks packaged builds even though dev still works.
    'src/main/**/*.ts',
    'src/system/**/*.ts',
    'src/server/**/*.ts',
    'src/preload/**/*',
    'src/shared/**/*.ts',
    'dist/web/**/*',
    'package.json',
    '!src/**/*.test.ts',
    '!**/*.map',
  ],
  asarUnpack: ['node_modules/node-pty/prebuilds/**/*'],
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
