import * as v from 'valibot'

const NODE_PLATFORMS = ['aix', 'android', 'darwin', 'freebsd', 'haiku', 'linux', 'openbsd', 'sunos', 'win32', 'cygwin', 'netbsd'] as const

export const HostInfoSnapshotSchema = v.strictObject({
  homeDir: v.string(),
  platform: v.picklist(NODE_PLATFORMS),
  hostname: v.string(),
  pid: v.pipe(v.number(), v.integer(), v.minValue(0)),
})

export const AccessTokenResponseSchema = v.strictObject({ accessToken: v.string() })
